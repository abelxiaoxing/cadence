/** Finite private child/owner bridge. Never a browser API or shell executor. */
import { Type } from "typebox";

const CHECK = Type.Object({
  name: Type.String(),
  command: Type.String(),
  timeoutMs: Type.Integer({ minimum: 100, maximum: 1200000 }),
});
const PLAN = Type.Object({
  goal: Type.String(),
  design: Type.String(),
  decisions: Type.String(),
  acceptance: Type.String(),
  projectContext: Type.String(),
  tasks: Type.Array(
    Type.Object({
      id: Type.String(),
      title: Type.String(),
      instructions: Type.String(),
      writes: Type.Array(Type.String()),
      after: Type.Array(Type.String()),
    }),
    { minItems: 1, maxItems: 16 },
  ),
  checks: Type.Array(CHECK, { minItems: 1, maxItems: 16 }),
  setup: Type.Array(CHECK, { maxItems: 4 }),
  baselineChecks: Type.Array(CHECK, { maxItems: 16 }),
  repairAttempts: Type.Integer({ minimum: 0, maximum: 2 }),
  delivery: Type.Union([
    Type.Literal("local-merge"),
    Type.Literal("working-copy"),
  ]),
});
export function coordinatorTools() {
  if (!process.send) throw new Error("Coordinator bridge unavailable");
  const pending = new Map();
  let counter = 0;
  let chain = Promise.resolve();
  const closed = () => {
    for (const p of pending.values())
      p.reject(new Error("Coordinator disconnected"));
    pending.clear();
  };
  process.on("disconnect", closed);
  process.on("message", (reply) => {
    if (
      !reply ||
      typeof reply !== "object" ||
      Buffer.byteLength(JSON.stringify(reply)) > 65536
    )
      return closed();
    const p = pending.get(reply.id);
    if (!p) return;
    pending.delete(reply.id);
    if (reply.ok === true && typeof reply.text === "string")
      p.resolve({
        content: [{ type: "text", text: reply.text }],
        details: undefined,
      });
    else p.reject(new Error("Coordinator refused this request"));
  });
  return [
    {
      name: "cadence_research",
      description:
        "Investigate bounded project questions with readonly subagents; returns recorded evidence. Never edits.",
      parameters: Type.Object({
        goal: Type.String(),
        questions: Type.Array(Type.String(), { minItems: 1, maxItems: 2 }),
        roots: Type.Optional(
          Type.Array(
            Type.String({
              description:
                "Specific investigation directories; defaults to project cwd. Avoid filesystem roots and broad parent trees.",
            }),
            { minItems: 1, maxItems: 8 },
          ),
        ),
      }),
    },
    {
      name: "cadence_plan",
      description:
        "Publish a complete proposal after decisions are aligned. This never authorizes execution. The user sees an exact plan card.",
      parameters: PLAN,
    },
    {
      name: "cadence_status",
      description:
        "Read actual workflow progress and outcomes, not inferred success.",
      parameters: Type.Object({}),
    },
  ].map((tool) => ({
    ...tool,
    label: tool.name,
    execute: async (_callId, args, signal) => {
      if (signal?.aborted || ++counter > 16 || pending.size >= 4)
        throw new Error("Coordinator budget exceeded");
      const request = { id: counter, name: tool.name, args };
      if (Buffer.byteLength(JSON.stringify(request)) > 65536)
        throw new Error("Coordinator request exceeds bound");
      const original = chain.then(
        () =>
          new Promise((resolve, reject) => {
            pending.set(request.id, { resolve, reject });
            process.send(request, (error) => {
              if (error) {
                pending.delete(request.id);
                reject(new Error("Coordinator request unavailable"));
              }
            });
          }),
      );
      chain = original.catch(() => {});
      return original;
    },
  }));
}
