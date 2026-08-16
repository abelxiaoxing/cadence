import type { Model, Usage } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  defineTool,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { DiffResult, EvidenceResult } from "./contracts.ts";
import { EmptyResourceLoader } from "./empty-resource-loader.ts";
import { createScopedTools } from "./scoped-tools.ts";
import {
  createSubmitTool,
  type FinalCategory,
  type SubmitClassification,
} from "./submit-tool.ts";

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export class UsageAggregator {
  private readonly ids = new Set<string>();
  private usage: Usage = structuredClone(ZERO_USAGE);
  add(id: string, value: Usage): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    this.usage = {
      input: this.usage.input + value.input,
      output: this.usage.output + value.output,
      cacheRead: this.usage.cacheRead + value.cacheRead,
      cacheWrite: this.usage.cacheWrite + value.cacheWrite,
      totalTokens: this.usage.totalTokens + value.totalTokens,
      cost: {
        input: this.usage.cost.input + value.cost.input,
        output: this.usage.cost.output + value.cost.output,
        cacheRead: this.usage.cost.cacheRead + value.cost.cacheRead,
        cacheWrite: this.usage.cost.cacheWrite + value.cost.cacheWrite,
        total: this.usage.cost.total + value.cost.total,
      },
    };
    return true;
  }
  total(): Usage {
    return structuredClone(this.usage);
  }
}

function wrapScopedTools(roots: string[]) {
  const order = ["read", "grep", "find", "ls"];
  return createScopedTools({ roots })
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
    .map((scoped) =>
      defineTool({
        name: scoped.name,
        label: scoped.name,
        description: scoped.description,
        parameters:
          scoped.name === "grep"
            ? Type.Object({ path: Type.String(), pattern: Type.String() })
            : Type.Object({ path: Type.String() }),
        async execute(_id, params) {
          const result = await scoped.execute(
            params as Record<string, unknown>,
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            details: result,
          };
        },
      }),
    );
}

export async function runChildSession(input: {
  cwd: string;
  modelRuntime: ModelRuntime;
  model: Model<string>;
  systemPrompt: string;
  requestId: string;
  role: string;
  phase?: string;
  output: "evidence" | "diff";
  roots: string[];
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<
  | {
      ok: true;
      result: EvidenceResult | DiffResult;
      toolNames: string[];
      submitCount: number;
      disposeCount: number;
      usage: Usage;
      classification: SubmitClassification;
    }
  | {
      ok: false;
      error: string;
      disposeCount: number;
      classification: SubmitClassification;
    }
> {
  const submit = createSubmitTool({
    requestId: input.requestId,
    role: input.role,
    phase: input.phase ?? "red",
    output: input.output,
  });
  const readTools = wrapScopedTools(input.roots);
  const customTools = [...readTools, submit.tool];
  const toolNames = customTools.map((tool) => tool.name);
  let disposeCount = 0;
  const usage = new UsageAggregator();
  const abort = new AbortController();
  const forwardCancellation = () =>
    abort.abort(input.signal?.reason ?? new Error("child phase cancelled"));
  if (input.signal?.aborted) forwardCancellation();
  else
    input.signal?.addEventListener("abort", forwardCancellation, {
      once: true,
    });
  const timer = setTimeout(
    () => abort.abort(new Error("child phase timeout")),
    input.timeoutMs,
  );
  let session:
    | Awaited<ReturnType<typeof createAgentSession>>["session"]
    | undefined;
  let unsubscribe: (() => void) | undefined;
  const disposeOnce = () => {
    if (session) {
      session.dispose();
      disposeCount++;
      session = undefined;
    }
  };
  const classifySession = (): SubmitClassification => {
    const assistants =
      session?.messages.filter((m) => m.role === "assistant") ?? [];
    const last = assistants.at(-1);
    let finalCategory: FinalCategory;
    if (!last) {
      finalCategory = "no-final-assistant";
    } else if (
      last.content.length === 1 &&
      last.content[0].type === "toolCall" &&
      last.content[0].name === "abel_submit_result"
    ) {
      finalCategory =
        submit.getAttempts() > 1 ? "multiple-submit" : "single-submit-only";
    } else if (last.content.length === 1 && last.content[0].type === "text") {
      finalCategory = "text-only";
    } else {
      finalCategory = "mixed";
    }
    return {
      finalCategory,
      attempts: submit.getAttempts(),
      schema: submit.getSchema(),
      identity: submit.getIdentity(),
    };
  };
  try {
    abort.signal.throwIfAborted();
    const creation = createAgentSession({
      cwd: input.cwd,
      modelRuntime: input.modelRuntime,
      model: input.model,
      thinkingLevel: "off",
      tools: toolNames,
      customTools,
      resourceLoader: new EmptyResourceLoader(input.systemPrompt),
      sessionManager: SessionManager.inMemory(input.cwd),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
      }),
    });
    try {
      ({ session } = await abortable(creation, abort.signal));
    } catch (error) {
      void creation
        .then(({ session: lateSession }) => lateSession.dispose())
        .catch(() => undefined);
      throw error;
    }
    abort.signal.throwIfAborted();
    unsubscribe = session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant") {
        usage.add(
          `${event.message.provider}:${event.message.model}:${event.message.timestamp}`,
          event.message.usage,
        );
      }
    });
    const onAbort = () => void session?.abort();
    abort.signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (abort.signal.aborted) throw abort.signal.reason;
      await Promise.race([
        session.prompt(input.systemPrompt, { expandPromptTemplates: false }),
        new Promise<never>((_, reject) =>
          abort.signal.addEventListener(
            "abort",
            () => reject(abort.signal.reason),
            { once: true },
          ),
        ),
      ]);
    } finally {
      abort.signal.removeEventListener("abort", onAbort);
    }
    const result = submit.getResult();
    const attempts = submit.getAttempts();
    const classification = classifySession();
    if (!result || attempts !== 1) {
      disposeOnce();
      return {
        ok: false,
        error: "child did not retain exactly one structural submission",
        disposeCount,
        classification,
      };
    }
    const assistants = session.messages.filter((m) => m.role === "assistant");
    const final = assistants.at(-1);
    if (
      !final ||
      final.role !== "assistant" ||
      final.content.length !== 1 ||
      final.content[0]?.type !== "toolCall" ||
      final.content[0]?.name !== "abel_submit_result"
    ) {
      disposeOnce();
      return {
        ok: false,
        error: "final assistant message is not one structural submit",
        disposeCount,
        classification,
      };
    }
    disposeOnce();
    return {
      ok: true,
      result,
      toolNames,
      submitCount: attempts,
      disposeCount,
      usage: usage.total(),
      classification,
    };
  } catch (error) {
    disposeOnce();
    return {
      ok: false,
      error: (error as Error).message,
      disposeCount,
      classification: classifySession(),
    };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", forwardCancellation);
    unsubscribe?.();
    disposeOnce();
  }
}
