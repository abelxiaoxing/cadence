import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { Activation } from "../src/activation.ts";
import { snapshotFiles } from "../src/file-snapshot.ts";
import { runtimeForProvider } from "../src/parent-provider.ts";
import { Runtime } from "../src/runtime.ts";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

interface FakeEndpoint {
  url: string;
  requests: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

const roots: string[] = [];
const endpoints: FakeEndpoint[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  for (const endpoint of endpoints.splice(0)) await endpoint.close();
});

function makeRoot(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `abel-runtime-endpoint-${tag}-`));
  roots.push(root);
  writeFileSync(join(root, "sentinel.txt"), "sentinel\n");
  return root;
}

function makeTaskRoot(): string {
  const root = makeRoot("pinned");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Cadence Test"], {
    cwd: root,
  });
  writeFileSync(join(root, "a.txt"), "old\n");
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "test"));
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      private: true,
      scripts: { check: "node test/check.mjs" },
    })}\n`,
  );
  writeFileSync(join(root, "bun.lock"), "# fixture lock\n");
  writeFileSync(
    join(root, "test/check.mjs"),
    [
      'import { readFileSync } from "node:fs";',
      'if (readFileSync("a.txt", "utf8") === "red\\n") {',
      '  console.error("[ENDPOINT-PIN:expected-red]");',
      "  process.exit(1);",
      "}",
      "",
    ].join("\n"),
  );
  execFileSync("git", ["add", "a.txt"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
  return root;
}

function writeProjectEnv(root: string, values: Record<string, string>): void {
  const dir = join(root, ".pi", "cadence");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, ".env"),
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
  );
}

function diffSubmit(id: string, phase: "red" | "green", diff: string) {
  return {
    id,
    role: "implementation-worker",
    kind: "diff",
    taskId: "pinned-endpoint-task",
    phase,
    summary: `apply ${phase} endpoint change`,
    diff,
    expectedVerification: phase === "red" ? "expected red" : "expected green",
    risks: [],
    contractCompliant: true,
  };
}

function completionsSSE(model: string, args: string): string {
  const chunk = (payload: Record<string, unknown>) =>
    `data: ${JSON.stringify(payload)}\n\n`;
  const base = {
    id: "chatcmpl-runtime-endpoint",
    object: "chat.completion.chunk",
    created: 1,
    model,
  };
  return (
    chunk({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call-runtime-endpoint",
                type: "function",
                function: { name: "abel_submit_result", arguments: args },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }) +
    chunk({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 4, completion_tokens: 8, total_tokens: 12 },
    }) +
    "data: [DONE]\n\n"
  );
}

async function startEndpoint(): Promise<FakeEndpoint> {
  const requests: Array<Record<string, unknown>> = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >;
      requests.push(body);
      const prompt = (body.messages as Array<{ content?: unknown }> | undefined)
        ?.map((message) =>
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content),
        )
        .join("\n");
      const green = prompt?.includes('"phase":"green"') === true;
      const id = green ? "pinned-endpoint:green:0" : "pinned-endpoint:red:0";
      const diff = green
        ? "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-red\n+green\n"
        : "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+red\n";
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        completionsSSE(
          String(body.model),
          JSON.stringify(diffSubmit(id, green ? "green" : "red", diff)),
        ),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("endpoint server has no address");
  const endpoint = {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
  endpoints.push(endpoint);
  return endpoint;
}

function implementRequest(root: string) {
  return {
    stage: "abel-implement",
    kind: "open-task",
    boundary: {
      changeId: "pinned-endpoint-change",
      taskId: "pinned-endpoint-task",
      objective: "Apply endpoint-pinned changes to a.txt",
      roots: ["."],
      context: { agents: "none", contract: "approved endpoint pin task" },
      phases: {
        red: {
          read: ["a.txt", "test/check.mjs"],
          write: ["a.txt"],
          verification: {
            id: "pinned-endpoint-red",
            argv: ["bun", "run", "check"],
            classification: "expected-red",
            expectedFailure: "[ENDPOINT-PIN:expected-red]",
            minTests: 1,
          },
        },
        green: {
          read: ["a.txt", "test/check.mjs"],
          write: ["a.txt"],
          verification: {
            id: "pinned-endpoint-green",
            argv: ["bun", "run", "check"],
            classification: "expected-green",
            minTests: 1,
          },
        },
      },
      scheduling: { conflicts: [], resources: [] },
      agents: { impact: "none", managedOnly: true },
      approvedDependencies: [],
      impactClosure: {
        changedSurfaces: ["none"],
        searchEvidence: [],
        relatedTests: [],
        affectedSuite: [],
      },
    },
    attempt: {
      changeId: "pinned-endpoint-change",
      taskId: "pinned-endpoint-task",
      requestId: "pinned-endpoint:red:0",
      phase: "red",
      snapshot: snapshotFiles(root, ["a.txt", "test/check.mjs"]),
    },
  } as const;
}

function evidence(id: string) {
  return {
    id,
    role: "design-explorer",
    kind: "evidence",
    packet_id: id,
    module_name: "runtime-endpoint",
    scope: ["a.txt"],
    files_read: ["a.txt"],
    evidence: [
      {
        claim: "inherited endpoint used",
        path: "a.txt",
        line_start: 1,
        line_end: 1,
      },
    ],
    existing_structures: ["inherited endpoint"],
    existing_conventions: [],
    constraints_discovered: [],
    open_questions: [],
    dependencies: [],
    write_set_hints: [],
    validation_hints: ["bun run check"],
    agents_impact_hints: ["none"],
    risks: [],
    success_criteria_hints: ["one structural submission"],
  };
}

function request(id: string) {
  return {
    stage: "abel-design",
    role: "design-explorer",
    id,
    phase: "evidence",
    objective: "Return endpoint evidence",
    roots: ["."],
    context: { agents: "package-only", contract: "approved evidence" },
    declared: {
      read: ["sentinel.txt"],
      write: [],
      conflicts: [],
      resources: [],
    },
    output: "evidence",
  };
}

async function within<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 8000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function harness(root: string, id: string) {
  const faux = fauxProvider({
    provider: `abel-runtime-endpoint-${id}`,
    api: "faux",
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("abel_submit_result", evidence(id)), {
      stopReason: "toolUse",
    }),
  ]);
  const modelRuntime = await runtimeForProvider(faux.provider);
  const activation = new Activation();
  activation.request();
  activation.activate();
  const runtime = new Runtime({
    activation,
    parentPayloadBridge: new PassthroughParentPayloadBridge(),
  });
  return {
    faux,
    runtime,
    context: {
      cwd: root,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    },
  };
}

describe("runtime subagent endpoint dispatch", () => {
  it("fails closed before a child launch and names only offending keys", async () => {
    const root = makeRoot("invalid");
    writeProjectEnv(root, {
      SUBAGENT_DESIGN_EXPLORER_MODEL: "private-partial-model",
      SUBAGENT_DESIGN_EXPLORER_API_KEY: "sk-private-endpoint-key",
    });
    const { faux, runtime, context } = await harness(root, "invalid-endpoint");

    const result = await (runtime as any).execute(
      "run",
      { request: request("invalid-endpoint") },
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "environment", code: "invalid-subagent-endpoint" },
    });
    expect(result.error).toContain("SUBAGENT_DESIGN_EXPLORER_API_URL");
    expect(JSON.stringify(result)).not.toContain("private-partial-model");
    expect(JSON.stringify(result)).not.toContain("sk-private-endpoint-key");
    expect(faux.state.callCount).toBe(0);
    await runtime.drain();
  });

  it("retains an invalid Implement configuration as a terminal replay", async () => {
    const root = makeTaskRoot();
    writeProjectEnv(root, {
      SUBAGENT_IMPLEMENTATION_WORKER_MODEL: "invalid-worker-model",
    });
    const { faux, runtime, context } = await harness(root, "invalid-implement");
    const opened = implementRequest(root);

    const first = await (runtime as any).execute(
      "run",
      { request: opened },
      context,
    );
    const replay = await (runtime as any).execute(
      "run",
      {
        request: {
          stage: "abel-implement",
          kind: "phase-attempt",
          attempt: {
            ...opened.attempt,
            requestId: "pinned-endpoint:red:replay",
          },
        },
      },
      context,
    );

    expect(first).toMatchObject({
      kind: "blocked",
      requestId: opened.attempt.requestId,
      failure: {
        kind: "environment",
        code: "invalid-subagent-endpoint",
        message:
          "invalid subagent endpoint configuration keys: SUBAGENT_IMPLEMENTATION_WORKER_API_URL",
      },
    });
    expect(replay).toMatchObject({
      kind: "blocked",
      requestId: "pinned-endpoint:red:replay",
      failure: {
        kind: "environment",
        code: "invalid-subagent-endpoint",
        message:
          "invalid subagent endpoint configuration keys: SUBAGENT_IMPLEMENTATION_WORKER_API_URL",
      },
    });
    expect(JSON.stringify(first)).not.toContain("invalid-worker-model");
    expect(JSON.stringify(replay)).not.toContain("invalid-worker-model");
    expect((runtime as any).registry.values()).toHaveLength(1);
    expect(faux.state.callCount).toBe(0);
    await runtime.drain();
  });

  it("keeps the no-configuration inherited path unchanged", async () => {
    const root = makeRoot("inherited");
    const { faux, runtime, context } = await harness(
      root,
      "inherited-endpoint",
    );

    const result = await (runtime as any).execute(
      "run",
      { request: request("inherited-endpoint") },
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "run",
      result: evidence("inherited-endpoint"),
    });
    expect(faux.state.callCount).toBe(1);
    await runtime.drain();
  });

  it("pins the custom endpoint at Implement task admission", async () => {
    const root = makeTaskRoot();
    const endpointA = await startEndpoint();
    const endpointB = await startEndpoint();
    writeProjectEnv(root, {
      SUBAGENT_IMPLEMENTATION_WORKER_MODEL: "pinned-worker-model",
      SUBAGENT_IMPLEMENTATION_WORKER_API_URL: endpointA.url,
      SUBAGENT_IMPLEMENTATION_WORKER_CONTEXT_WINDOW: "100000",
      SUBAGENT_IMPLEMENTATION_WORKER_MAX_TOKENS: "4096",
    });
    const { runtime, context } = await harness(root, "pinned-parent");
    const opened = implementRequest(root);

    const red: any = await within(
      "red dispatch",
      (runtime as any).execute("run", { request: opened }, context),
    );
    expect(red).toMatchObject({ kind: "candidate", phase: "red" });
    expect(red.result.diff).toBe(
      "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+red\n",
    );

    const applied: any = await within(
      "red apply",
      (runtime as any).execute(
        "apply",
        { resultId: red.resultId, requestId: "pinned-endpoint:apply:red" },
        context,
      ),
    );
    expect(applied).toMatchObject({ kind: "applied", readyPhase: "green" });

    writeProjectEnv(root, {
      SUBAGENT_IMPLEMENTATION_WORKER_MODEL: "edited-worker-model",
      SUBAGENT_IMPLEMENTATION_WORKER_API_URL: endpointB.url,
    });
    const green: any = await within(
      "green dispatch",
      (runtime as any).execute(
        "run",
        {
          request: {
            stage: "abel-implement",
            kind: "phase-attempt",
            attempt: {
              changeId: "pinned-endpoint-change",
              taskId: "pinned-endpoint-task",
              requestId: "pinned-endpoint:green:0",
              phase: "green",
              snapshot: snapshotFiles(root, ["a.txt", "test/check.mjs"]),
            },
          },
        },
        context,
      ),
    );

    expect(green).toMatchObject({ kind: "candidate", phase: "green" });
    expect(endpointA.requests).toHaveLength(2);
    expect(endpointB.requests).toHaveLength(0);
    expect(endpointA.requests.map((body) => body.model)).toEqual([
      "pinned-worker-model",
      "pinned-worker-model",
    ]);
    await runtime.drain();
  }, 30000);
});
