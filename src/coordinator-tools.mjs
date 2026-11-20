/** Serialized private child/owner bridge. Never a browser API or shell executor. */
import { createHash } from "node:crypto";
import { Type } from "typebox";
import {
  canonicalJson,
  closed,
  knowledgeFields,
  LIMITS,
} from "./worker-public.mjs";

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
const lookupExample =
  'Use {checkout:["node_modules"]}, {checkout:[]}, {path:"docs.md"} with optional section or match, or {investigation:"<retained UUID>"}.';
/** Only model arguments may contain empty placeholders. Validate before the SDK
 * coerces scalar types, and again at direct tool entry (no caller is trusted). */
export function knowledgeToolInput(input) {
  const bad = (field, why) => {
    throw new Error(`${field}: ${why}. ${lookupExample}`);
  };
  const keys = Object.keys(input ?? {});
  let raw;
  try {
    raw = closed(input, keys);
  } catch {
    bad("cadence_knowledge", "expected an object with named lookup fields");
  }
  const fields = Object.create(null);
  for (const key of keys) {
    if (!Object.hasOwn(knowledgeFields, key))
      bad(JSON.stringify(key.slice(0, 80)), "unknown field; omit it");
    if (key !== "checkout" && raw[key] === "") continue;
    try {
      fields[key] = knowledgeFields[key](raw[key]);
    } catch {
      bad(
        key,
        key === "checkout"
          ? "give an array of up to eight nonempty dependency paths (each at most 1024 bytes)"
          : key === "investigation"
            ? "give a retained investigation UUID"
            : "give a nonblank string within the field limit",
      );
    }
  }
  const { checkout, path, section, match, investigation } = fields;
  if ((section || match) && !path)
    bad(
      section ? "section/path" : "match/path",
      "name the source file in path",
    );
  if (section && match) bad("section/match", "choose one selector");
  if (checkout?.length && (path || investigation))
    bad("checkout", "cannot combine dependencies with path or investigation");
  if (investigation && path) bad("investigation/path", "choose one source");
  const relative = (name) =>
    !/[\\:\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name) &&
    name
      .split("/")
      .every(
        (part) =>
          part &&
          part !== "." &&
          part !== ".." &&
          part.toLowerCase() !== ".git",
      );
  if (path && !relative(path))
    bad("path", "give a plain checkout-relative file path");
  if (
    checkout?.some(
      (name) =>
        !relative(name) || name.split("/").some((part) => part.startsWith(".")),
    )
  )
    bad("checkout", "give plain checkout-relative dependency names");
  if (investigation) return { investigation };
  if (path)
    return match ? { path, match } : section ? { path, section } : { path };
  if (checkout) return { checkout };
  bad("path/checkout/investigation", "no lookup selected");
}
export const KNOWLEDGE_PARAMETERS = Type.Object({
  checkout: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Instead of other fields, give up to eight checkout-relative dependency directory names (e.g. node_modules and web/node_modules), or [] for Git placement only. Observe the original checkout, Git branch and HEAD, and whether each named entry is a directory, symlink or absent. Never follows a dependency link.",
    }),
  ),
  path: Type.Optional(
    Type.String({
      description:
        "One checkout-relative document, or the exact project source file containing a known fact.",
    }),
  ),
  section: Type.Optional(
    Type.String({
      description: "Exact Markdown heading. Use either section or match.",
    }),
  ),
  match: Type.Optional(
    Type.String({
      description:
        "A literal on a line of this source file (such as a token, assertion or build script). Return matching line numbers with short previews and context at the first occurrence, without a research worker.",
    }),
  ),
  investigation: Type.Optional(
    Type.String({
      description:
        "Instead of path/section, supply a retained investigation ID to recheck its sources and reuse the answer.",
    }),
  ),
});
export const DESIGN_PARAMETERS = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String(),
      question: Type.String(),
      options: Type.Array(
        Type.Object({
          id: Type.String(),
          label: Type.String(),
          cost: Type.String(),
        }),
      ),
      recommended: Type.String({ description: "Recommended option ID" }),
      reason: Type.String(),
      acceptance: Type.String({
        description: "Acceptance item this decision affects",
      }),
      when: Type.Optional(
        Type.Union(
          [
            Type.Null(),
            Type.Object({ question: Type.String(), option: Type.String() }),
          ],
          {
            description:
              "Omit or use null for an independent question. For a conditional question give an earlier question ID and one of its option IDs.",
          },
        ),
      ),
    }),
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
  // Design validation refusals describe the arguments, not mutable project
  // state. Remember only the last one for this coordinator's lifetime.
  let invalidDesign;
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
    if (reply.ok === true && typeof reply.text === "string") {
      if (p.design || p.plan) {
        let value;
        try {
          value = JSON.parse(reply.text);
        } catch {
          /* Not a structured refusal. */
        }
        if (
          (value?.refused === "invalid" || value?.refused === "invalid-plan") &&
          typeof value.notice === "string"
        ) {
          if (p.design) invalidDesign = { key: p.design, notice: value.notice };
          return p.reject(new Error(value.notice));
        }
        if (p.design) invalidDesign = undefined;
      }
      p.resolve({
        content: [{ type: "text", text: reply.text }],
        details: undefined,
      });
    } else
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
      name: "cadence_knowledge",
      description:
        "Read current checkout preparation facts, a project heading, a literal in one source file, or a retained investigation with its citations rechecked.",
      parameters: KNOWLEDGE_PARAMETERS,
      prepareArguments: knowledgeToolInput,
    },
    {
      name: "cadence_design",
      description:
        "Show all material product choices, recommendations, tradeoffs and affected acceptance together. End this turn after publication. Only the user submits design choices.",
      parameters: DESIGN_PARAMETERS,
    },
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
        "Read actual workflow progress and outcomes. With a result's runId and stepId, read its retained JSON result in pages; pass next unchanged to continue. limited describes missing retained evidence, independently of pagination. Read truncated research answers here before investigating again. Never starts work.",
      parameters: Type.Object({
        runId: Type.Optional(Type.String()),
        stepId: Type.Optional(Type.String()),
        offset: Type.Optional(Type.Integer()),
        digest: Type.Optional(Type.String()),
      }),
    },
  ].map((tool) => ({
    ...tool,
    label: tool.name,
    execute: async (_callId, args, signal) => {
      if (retiring) throw new Error("Coordinator closed");
      if (signal?.aborted) throw new Error("Coordinator canceled");
      const request = {
        id: ++counter,
        name: tool.name,
        args:
          tool.name === "cadence_knowledge" ? knowledgeToolInput(args) : args,
      };
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
            const design =
              tool.name === "cadence_design"
                ? createHash("sha256")
                    .update(canonicalJson(args, LIMITS.coordinatorBytes))
                    .digest("hex")
                : undefined;
            if (design && invalidDesign?.key === design)
              return reject(
                new Error(
                  `Unchanged invalid design was not sent. ${invalidDesign.notice}`,
                ),
              );
            pending.set(request.id, {
              resolve,
              reject,
              design,
              plan: tool.name === "cadence_plan",
            });
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
