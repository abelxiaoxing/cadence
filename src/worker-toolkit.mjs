/** Trusted capability composition. No discovery, plugin claims or model-selected
 * permissions. Role prompts do not grant tools; the validated owner request does. */
import { Type } from "typebox";
import { createChangeTools } from "./change-tools.mjs";
import { createCoordinatorTools } from "./coordinator-tools.mjs";
import { createResearchTools } from "./research-tools.mjs";
import { sanitizeText } from "./worker-redaction.mjs";
import { captureBash } from "./worker-tools.mjs";

const policies = Object.freeze({
  edit: Object.freeze(["files", "shell"]),
  research: Object.freeze(["observation"]),
  diagnosis: Object.freeze(["observation"]),
  review: Object.freeze(["observation"]),
  coordination: Object.freeze(["coordination"]),
});
// One reviewed registry, not a public runtime plugin interface. An observation
// bundle may add tools without teaching the SDK bootstrap another list of names.
const bundles = {
  files: () => ({
    names: ["read", "grep", "find", "ls", "write", "edit"],
    tools: [],
  }),
  shell: ({ workspace, secrets, fail, createLocalBashOperations, queue }) => ({
    tools: [
      captureBash(
        workspace.cwd,
        secrets,
        fail,
        createLocalBashOperations,
        queue,
      ),
    ],
  }),
  observation: ({ workspace }) => createResearchTools(workspace),
  changes: ({ changes }) => createChangeTools(changes),
  coordination: () => createCoordinatorTools(),
};

export function createWorkerToolkit(options) {
  const { purpose, coordinator = false } = options;
  if (
    !Object.hasOwn(policies, purpose) ||
    purpose === "coordination" ||
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
  const capabilities = options.changes
    ? Object.freeze([...policies[purpose], "changes"])
    : policies[coordinator ? "coordination" : purpose];
  const owned = capabilities.map((capability) => bundles[capability](options));
  const customTools = owned.flatMap((bundle) => bundle.tools);
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
  const names = owned.flatMap(
    (bundle) => bundle.names ?? bundle.tools.map((tool) => tool.name),
  );
  if (options.reporting && !coordinator && purpose === "edit")
    names.push("cadence_report");
  if (new Set(names).size !== names.length)
    throw new Error("Duplicate worker tool");
  const originals = new Set();
  let closed = false,
    closing;
  return {
    capabilities,
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
            const original = Promise.resolve().then(() => {
              if (closed) throw new Error("Worker tools closed");
              if (args[2]?.aborted) throw new Error("Worker tool canceled");
              return tool.execute(...args);
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
