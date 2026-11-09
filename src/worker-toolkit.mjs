/** Trusted capability composition. No discovery, plugin claims or model-selected
 * permissions. Role prompts do not grant tools; the validated owner request does. */
import {
  createBashToolDefinition,
  createPowerShellToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createChangeTools } from "./change-tools.mjs";
import { createCoordinatorTools } from "./coordinator-tools.mjs";
import {
  createResearchTools,
  RESEARCH_INSTRUCTIONS,
} from "./research-tools.mjs";
import { sanitizeText } from "./worker-redaction.mjs";
import { captureShell } from "./worker-tools.mjs";

export function createWorkerToolkit(options) {
  const { purpose, coordinator = false } = options;
  if (
    !["edit", "research", "diagnosis", "review"].includes(purpose) ||
    (coordinator && purpose !== "research")
  )
    throw new Error("Invalid worker capability selection");
  if (
    options.changes &&
    (purpose !== "review" ||
      coordinator ||
      options.changes.root !== options.workspace.roots[0])
  )
    throw new Error("Invalid review capability binding");
  const runtime = options.runtime;
  if (!runtime) throw new Error("Worker runtime settings are required");
  const readonly = purpose !== "edit";
  const names = [...runtime.tools[readonly ? "readonly" : "edit"]];
  const owned = [];
  const customTools = [];
  if (coordinator) {
    const bridge = createCoordinatorTools();
    owned.push(bridge);
    customTools.push(...bridge.tools);
    names.splice(0, names.length, ...bridge.tools.map((tool) => tool.name));
  } else if (readonly) {
    const observation = createResearchTools(
      options.workspace,
      names,
      runtime.settings,
    );
    owned.push(observation);
    customTools.push(...observation.tools);
  } else {
    for (const name of names.filter((name) =>
      ["bash", "powershell"].includes(name),
    )) {
      const bash = name === "bash";
      const definition = (
        bash ? createBashToolDefinition : createPowerShellToolDefinition
      )(options.workspace.cwd);
      const operations = () =>
        bash
          ? options.createLocalBashOperations({
              shellPath: runtime.settings.shellPath,
            })
          : options.createLocalPowerShellOperations();
      customTools.push(
        captureShell(
          options.workspace.cwd,
          options.secrets,
          options.fail,
          operations,
          options.queue,
          definition,
          bash ? runtime.settings.shellCommandPrefix : undefined,
        ),
      );
    }
  }
  if (options.changes) {
    const changes = createChangeTools(options.changes);
    owned.push(changes);
    customTools.push(...changes.tools);
    names.push(...changes.tools.map((tool) => tool.name));
  }
  if (options.reporting && !coordinator && purpose === "edit")
    customTools.push({
      name: "cadence_report",
      label: "Report assignment outcome",
      description:
        "Submit this assignment's structured result after all work. Completed means assigned work is done, not that owner checks or review passed. Use blocked for remaining work. Then give a brief final answer; no JSON formatting is required in that answer. Any later tool call requires a new report.",
      parameters: Type.Object({
        status: Type.Union([
          Type.Literal("completed"),
          Type.Literal("blocked"),
        ]),
        summary: Type.String({ minLength: 1, maxLength: 8192 }),
      }),
      async execute(_id, input) {
        if (
          !input ||
          !["completed", "blocked"].includes(input.status) ||
          typeof input.summary !== "string" ||
          !input.summary.trim() ||
          Object.keys(input).some((key) => !["status", "summary"].includes(key))
        )
          throw new Error("Invalid assignment report");
        const report = {
          status: input.status,
          summary: sanitizeText(input.summary, options.secrets ?? []),
        };
        const text = JSON.stringify(report);
        if (!report.summary.trim() || Buffer.byteLength(text) > 16384)
          throw new Error("Assignment report exceeds bound");
        return { content: [{ type: "text", text }], details: undefined };
      },
    });
  if (options.reporting && !coordinator && purpose === "edit")
    names.push("cadence_report");
  if (new Set(names).size !== names.length)
    throw new Error("Duplicate worker tool");
  const originals = new Set();
  let closed = false,
    closing;
  return {
    instructions: readonly && !coordinator ? RESEARCH_INSTRUCTIONS : "",
    // Explicit allowlists are required by the installed public Pi SDK. Omitting
    // one would enable its defaults, not mean "only our custom capabilities".
    sessionOptions: {
      cwd: options.workspace.cwd,
      tools: [...names],
      customTools,
    },
    wrap(tools) {
      if (closed) throw new Error("Worker tools closed");
      return tools.map((tool) => {
        if (!names.includes(tool.name))
          throw new Error("Unexpected worker tool");
        return {
          ...tool,
          execute: (...args) => {
            if (closed) return Promise.reject(new Error("Worker tools closed"));
            const original = Promise.resolve().then(async () => {
              if (closed) throw new Error("Worker tools closed");
              const signal = args[2];
              if (signal?.aborted) throw new Error("Worker tool canceled");
              const fileTool = [
                "read",
                "grep",
                "find",
                "ls",
                "write",
                "edit",
              ].includes(tool.name);
              // Stock file tools may reject an abort observer before their real
              // I/O finishes. Join this admitted call to its actual settlement,
              // then suppress its result if canceled. Pi grep already waits for
              // child close on abort, so preserve its stop signal like shell and
              // changes; no mutation is replayed.
              const forwarded = [...args];
              if (fileTool && tool.name !== "grep") forwarded[2] = undefined;
              const result = await tool.execute(...forwarded);
              if (fileTool && signal?.aborted)
                throw new Error(
                  "Worker tool canceled; its original operation settled and may have completed",
                );
              return result;
            });
            const tracked = original.finally(() => originals.delete(tracked));
            originals.add(tracked);
            return tracked;
          },
        };
      });
    },
    close() {
      if (closing) return closing;
      closed = true;
      // Start all owned closes, and join every original, including stock SDK
      // tools. Session abort is requested separately by the runtime; a timeout
      // or an observer's rejection never substitutes for actual tool settlement.
      closing = (async () => {
        const outcomes = await Promise.allSettled([
          ...originals,
          ...owned.map((bundle) =>
            Promise.resolve().then(() => bundle.close?.()),
          ),
        ]);
        // Tool execution errors belong to their original caller; only resource
        // disposal errors make the toolkit's cleanup itself fail.
        if (
          outcomes
            .slice(outcomes.length - owned.length)
            .some((outcome) => outcome.status === "rejected")
        )
          throw new Error("Worker tool cleanup failed");
      })();
      return closing;
    },
  };
}
