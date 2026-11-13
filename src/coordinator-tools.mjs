/** Serialized private child/owner bridge. Never a browser API or shell executor. */
import { Type } from "typebox";
import { LIMITS } from "./worker-public.mjs";

/** The parameters of the two tools a coordinator calls, declared once for the
 * native extension and the browser coordinator. They state shape only: counts,
 * sizes and references are checked by the service, which refuses naming the
 * field (`workflowPlanInput`, `researchInput`), so a call is never rejected
 * before the service has seen it for a bound the model could not know. */
const CHECK = Type.Object({
  name: Type.String(),
  command: Type.String(),
  timeoutMs: Type.Optional(
    Type.Integer({
      description: "Milliseconds, from 100. Leave out for no timeout.",
    }),
  ),
});
const READING = Type.Union([
  Type.Object({
    path: Type.String({ description: "Project document to read first." }),
    section: Type.Optional(
      Type.String({ description: "One heading of that document." }),
    ),
    reason: Type.String(),
  }),
  Type.Object({
    research: Type.String({
      description:
        'A recorded investigation: the "investigation" value of a completed research step.',
    }),
    reason: Type.String(),
  }),
]);
export const RESEARCH_PARAMETERS = Type.Object({
  goal: Type.String(),
  questions: Type.Array(
    Type.String({
      description: "One focused, independent question.",
    }),
    {
      description:
        "Split independent questions freely; the service runs as many at once as this machine is configured for and queues the rest.",
    },
  ),
  roots: Type.Optional(
    Type.Array(
      Type.String({
        description:
          "Specific investigation directories, relative to this conversation's cwd by default. Avoid filesystem roots and broad parent trees.",
      }),
    ),
  ),
});
export const PLAN_PARAMETERS = Type.Object({
  goal: Type.String(),
  design: Type.String({ description: "The initial technical route." }),
  decisions: Type.Optional(
    Type.String({ description: "Explicit decisions and non-goals." }),
  ),
  acceptance: Type.String(),
  assumptions: Type.Optional(
    Type.String({
      description:
        "What you decided on the user's behalf without asking; approval confirms it. Leave out when there is none.",
    }),
  ),
  documents: Type.Optional(
    Type.Array(
      Type.String({
        description: "Existing project Markdown this delivery may update.",
      }),
    ),
  ),
  reviewReads: Type.Optional(
    Type.Array(READING, {
      description: "What the independent review reads first.",
    }),
  ),
  policy: Type.Optional(
    Type.Object({
      installs: Type.Optional(
        Type.Boolean({
          description:
            "Whether a later revision may add dependency-installation commands. False unless the user agreed.",
        }),
      ),
    }),
  ),
  tasks: Type.Array(
    Type.Object({
      id: Type.String({
        description:
          "Lowercase letters, digits and hyphens, starting with a letter.",
      }),
      title: Type.String(),
      instructions: Type.String({ description: "At most 8KiB." }),
      writes: Type.Array(Type.String()),
      after: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Ids of the assignments this one really depends on. Leave out when it depends on none.",
        }),
      ),
      reads: Type.Optional(
        Type.Array(READING, {
          description: "The few things this assignment should read first.",
        }),
      ),
    }),
    { description: "One to 16 assignments." },
  ),
  checks: Type.Array(CHECK, {
    description: "The real acceptance commands: at least one, at most 16.",
  }),
  setup: Type.Optional(
    Type.Array(
      Type.Object({
        ...CHECK.properties,
        placement: Type.Union(
          [
            Type.Literal("target"),
            Type.Literal("candidate"),
            Type.Literal("worktree"),
          ],
          {
            description:
              "target: preflight once in the original checkout before creating worktrees; candidate: once in the stable candidate; worktree: prepare the candidate and every detached child. Target branch checks belong to target, never worktree. Commands do not export environment into later processes.",
          },
        ),
      }),
      {
        description:
          "Explicit preparation commands with their execution placement, at most four. Run in target, candidate, then worktree stages, preserving order within each stage.",
      },
    ),
  ),
  baselineChecks: Type.Optional(Type.Array(CHECK)),
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
    // Credential replies and messages for the running reply share the private
    // transport, never the tool channel.
    if (["auth", "input", "input-cancel"].includes(reply?.kind)) return;
    if (
      !reply ||
      typeof reply !== "object" ||
      Buffer.byteLength(JSON.stringify(reply)) > LIMITS.coordinatorBytes
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
    // The service did nothing; its fixed code says why it could not.
    else
      p.reject(
        new Error(
          typeof reply.code === "string" && /^[a-z-]{1,40}$/.test(reply.code)
            ? `The service refused this call (${reply.code}); nothing was started or published.`
            : "The service refused this call; nothing was started or published.",
        ),
      );
  };
  process.on("message", receive);
  const tools = [
    {
      name: "cadence_research",
      description:
        "Investigate focused, independent project questions with readonly subagents, as many as the goal needs; returns each question's recorded answer and its investigation identity. Never edits.",
      parameters: RESEARCH_PARAMETERS,
    },
    {
      name: "cadence_plan",
      description:
        "Publish a complete proposal after decisions are aligned. This never authorizes execution. The user sees an exact plan card. goal, design, decisions, assumptions and acceptance together fit 32KiB, because every worker is given them.",
      parameters: PLAN_PARAMETERS,
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
      if (Buffer.byteLength(JSON.stringify(request)) > LIMITS.coordinatorBytes)
        throw new Error(
          `This call is larger than ${LIMITS.coordinatorBytes} bytes and was not sent; nothing happened.`,
        );
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
