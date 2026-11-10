/** Serialized private child/owner bridge. Never a browser API or shell executor. */
import { Type } from "typebox";

const CHECK = Type.Object({
  name: Type.String(),
  command: Type.String(),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 2147483647 })),
});
const PLAN = Type.Object({
  goal: Type.String(),
  design: Type.String(),
  decisions: Type.String(),
  acceptance: Type.String(),
  version: Type.Literal(2),
  knowledge: Type.Array(Type.String(), { maxItems: 16 }),
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
  delivery: Type.Union([
    Type.Literal("local-merge"),
    Type.Literal("working-copy"),
  ]),
});
export function createCoordinatorTools() {
  if (!process.send) throw new Error("Coordinator bridge unavailable");
  const pending = new Map();
  let counter = 0;
  let chain = Promise.resolve();
  let disconnected = false;
  let retiring = false;
  let retirement;
  const closed = () => {
    disconnected = true;
    for (const p of pending.values())
      p.reject(new Error("Coordinator disconnected"));
    pending.clear();
  };
  process.on("disconnect", closed);
  const receive = (reply) => {
    // Credential replies share the private transport, never the tool channel.
    if (reply?.kind === "auth") return;
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
  };
  process.on("message", receive);
  const tools = [
    {
      name: "cadence_research",
      description:
        "Investigate bounded project questions with readonly subagents; returns recorded evidence. Never edits.",
      parameters: Type.Object({
        goal: Type.String(),
        // Split independent questions freely; the owner bounds how many run at once.
        questions: Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
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
      if (retiring) throw new Error("Coordinator closed");
      if (signal?.aborted) throw new Error("Coordinator canceled");
      const request = { id: ++counter, name: tool.name, args };
      if (Buffer.byteLength(JSON.stringify(request)) > 65536)
        throw new Error("Coordinator request exceeds bound");
      const original = chain.then(
        () =>
          new Promise((resolve, reject) => {
            if (signal?.aborted) throw new Error("Coordinator canceled");
            if (disconnected) throw new Error("Coordinator disconnected");
            if (retiring) throw new Error("Coordinator closed");
            pending.set(request.id, { resolve, reject });
            const unavailable = () => {
              pending.delete(request.id);
              reject(new Error("Coordinator request unavailable"));
            };
            try {
              process.send(request, (error) => {
                if (error) unavailable();
              });
            } catch {
              // Synchronous transport failures own the same cleanup as the
              // callback path; never retain pending entries or expose raw errors.
              unavailable();
            }
          }),
      );
      chain = original.catch(() => {});
      return original;
    },
  }));
  return {
    tools,
    close() {
      retiring = true;
      // Already-sent calls still own their original reply/disconnect lifetime.
      // Queued calls refuse before sending; listeners stay until that joins.
      retirement ??= chain.finally(() => {
        process.removeListener("disconnect", closed);
        process.removeListener("message", receive);
      });
      return retirement;
    },
  };
}
