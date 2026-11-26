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

/** The structured submission of each readonly role that has one; the role's
 * final prose then carries no JSON. */
const SUBMISSION = Object.freeze({
  plan: "cadence_route",
  diagnosis: "cadence_recovery",
});

export function createWorkerToolkit(options) {
  const { purpose, coordinator = false } = options;
  if (
    !["edit", "research", "plan", "diagnosis", "review"].includes(purpose) ||
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
    const submission = createSubmissionTools().find(
      (tool) => tool.name === SUBMISSION[purpose],
    );
    if (submission) {
      customTools.push(submission);
      names.push(submission.name);
    }
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
        "Submit this assignment's structured result after all work. Completed means assigned work is done, not that owner checks or review passed. Use partial when useful work is preserved but assigned work remains, or blocked when a concrete prerequisite prevents further progress. Neither is an execution crash or passing verification. Then give a brief final answer; no JSON formatting is required in that answer. Any later editing, shell or unknown tool call requires a new report; readonly inspection does not invalidate it.",
      parameters: Type.Object({
        status: Type.Union([
          Type.Literal("completed"),
          Type.Literal("partial"),
          Type.Literal("blocked"),
        ]),
        summary: Type.String({ minLength: 1, maxLength: 8192 }),
        lessons: Type.Optional(
          Type.Array(Type.String({ minLength: 1, maxLength: 400 }), {
            maxItems: 5,
            description:
              "Usually omitted. Only what this work taught that the code does not show and a later worker here would have to rediscover: a constraint between parts, a trap you hit, a convention. One sentence each, naming the file or symbol. The owner checks each before keeping it.",
          }),
        ),
      }),
      async execute(_id, input) {
        if (
          !input ||
          !["completed", "partial", "blocked"].includes(input.status) ||
          typeof input.summary !== "string" ||
          !input.summary.trim() ||
          Object.keys(input).some(
            (key) => !["status", "summary", "lessons"].includes(key),
          ) ||
          (input.lessons !== undefined &&
            (!Array.isArray(input.lessons) ||
              input.lessons.length > 5 ||
              input.lessons.some(
                (lesson) =>
                  typeof lesson !== "string" ||
                  !lesson.trim() ||
                  lesson.length > 400,
              )))
        )
          throw new Error("Invalid assignment report");
        const report = {
          status: input.status,
          summary: sanitizeText(input.summary, options.secrets ?? []),
          ...(input.lessons?.length
            ? {
                lessons: input.lessons.map((lesson) =>
                  sanitizeText(lesson, options.secrets ?? []),
                ),
              }
            : {}),
        };
        const text = JSON.stringify(report);
        if (!report.summary.trim() || Buffer.byteLength(text) > 16384)
          throw new Error("Assignment report exceeds bound");
        return {
          content: [{ type: "text", text: "Assignment report submitted." }],
          details: report,
        };
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

/** Structured submissions a worker hands the owner through a tool instead of
 * its final prose, beside cadence_report: one per readonly structured role.
 * The parameters state the shape and the bounds a model can check itself; the
 * installed SDK validates a call before `execute` and returns field-named
 * errors into the same session, so a correction costs one turn, not a new
 * worker that reads the repository again. `execute` closes what the schema
 * leaves open and serializes the accepted call itself: a hand-escaped reply is
 * never parsed. Values pass through untouched. Every gate that needs owner
 * knowledge (secrets, recorded investigations, Git-ignore rules, managed links,
 * the run's scope) stays with the owner, which decodes the retained result. */

/** Bounds mirrored from the owner contract (`src/service/contracts/workflow.ts`,
 * `src/service/workflow-controller.ts`); `test/worker-structure.test.mjs` pins
 * them equal. Bytes are the owner's measure; the schema states characters. */
export const SUBMISSION_LIMITS = Object.freeze({
  tasks: 16,
  readings: 16,
  documents: 16,
  writes: 128,
  idLength: 48,
  title: 256,
  instructions: 8192,
  section: 256,
  readingReason: 512,
  blockReason: 4096,
  routeBytes: 65536,
  evidence: 32,
  evidenceId: 160,
  scope: 64,
  work: 16,
  routeDrop: 48,
  waive: 128,
  cause: 2048,
  strategy: 4096,
  deviationField: 4096,
  recoveryBytes: 32768,
});

const ID = Type.String({
  pattern: "^[a-z][a-z0-9-]{0,47}$",
  description:
    "Assignment ID and worktree name: lowercase letters, digits and hyphens, starting with a letter, at most 48 characters.",
});
const PATH = Type.String({
  minLength: 1,
  description:
    "Checkout-relative repository path; never .git, .env, credentials, keys or a managed link.",
});
const text = (maximum, description) =>
  Type.String({ minLength: 1, maxLength: maximum, description });
const READING = Type.Union(
  [
    Type.Object(
      {
        path: PATH,
        section: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: SUBMISSION_LIMITS.section,
            description:
              "Exact Markdown heading; use either section or nothing.",
          }),
        ),
        reason: text(
          SUBMISSION_LIMITS.readingReason,
          "Why this should be read before the work starts.",
        ),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        research: Type.String({
          minLength: 1,
          description: "The investigation value of a completed research step.",
        }),
        reason: text(
          SUBMISSION_LIMITS.readingReason,
          "Why this investigation should be read before the work starts.",
        ),
      },
      { additionalProperties: false },
    ),
  ],
  {
    description: "A file (optionally one heading) or a recorded investigation.",
  },
);

export const ROUTE_PLAN_PARAMETERS = Type.Object(
  {
    action: Type.Optional(
      Type.Union([Type.Literal("plan"), Type.Literal("blocked")], {
        description:
          'Omit for a plan. "blocked" only when the approved agreement cannot be fulfilled inside the repository; then give reason and nothing else.',
      }),
    ),
    reason: Type.Optional(
      text(
        SUBMISSION_LIMITS.blockReason,
        "For a blocked plan: the concrete source evidence why the agreement cannot be fulfilled.",
      ),
    ),
    tasks: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: ID,
            title: Type.String({
              minLength: 1,
              maxLength: SUBMISSION_LIMITS.title,
              description: "Short imperative title.",
            }),
            instructions: Type.String({
              minLength: 1,
              maxLength: SUBMISSION_LIMITS.instructions,
              description:
                "The complete assignment. Name files, symbols and conventions; reference code by path, section or investigation instead of pasting it.",
            }),
            writes: Type.Array(PATH, {
              minItems: 1,
              maxItems: SUBMISSION_LIMITS.writes,
              description:
                "Every file this assignment creates or edits. Assignments that run side by side never share a write path.",
            }),
            after: Type.Optional(
              Type.Array(ID, {
                maxItems: SUBMISSION_LIMITS.tasks,
                description: "IDs of assignments that must integrate first.",
              }),
            ),
            reads: Type.Optional(
              Type.Array(READING, {
                maxItems: SUBMISSION_LIMITS.readings,
                description:
                  "What the implementation worker should read first.",
              }),
            ),
          },
          { additionalProperties: false },
        ),
        {
          minItems: 1,
          maxItems: SUBMISSION_LIMITS.tasks,
          description:
            "Assignments with disjoint writes run side by side; wire cross-module integration through after.",
        },
      ),
    ),
    reviewReads: Type.Optional(
      Type.Array(READING, {
        maxItems: SUBMISSION_LIMITS.readings,
        description:
          "At most 16 reads that save review workers from rediscovering the change.",
      }),
    ),
    documents: Type.Optional(
      Type.Array(Type.String({ pattern: "\\.md$", minLength: 1 }), {
        maxItems: SUBMISSION_LIMITS.documents,
        description:
          "Existing Markdown documents the agreement requires updating; never under .cadence/.",
      }),
    ),
  },
  { additionalProperties: false },
);

export const RECOVERY_LEVELS = Object.freeze(["repair", "replan", "deviate"]);
export const RECOVERY_BLOCKERS = Object.freeze([
  "model",
  "authentication",
  "storage",
  "installation",
  "tool",
]);
const ASSIGNMENT = (maxItems, description) =>
  Type.Array(
    Type.Object(
      {
        id: ID,
        title: Type.String({
          minLength: 1,
          maxLength: SUBMISSION_LIMITS.title,
        }),
        instructions: Type.String({
          minLength: 1,
          maxLength: SUBMISSION_LIMITS.instructions,
        }),
        writes: Type.Array(PATH, {
          minItems: 1,
          maxItems: SUBMISSION_LIMITS.writes,
        }),
        after: Type.Array(ID, { maxItems: SUBMISSION_LIMITS.tasks }),
      },
      { additionalProperties: false },
    ),
    { maxItems, description },
  );

export const RECOVERY_PARAMETERS = Type.Object(
  {
    action: Type.Union([Type.Literal("continue"), Type.Literal("blocked")], {
      description:
        '"blocked" only for a condition outside the repository that no route can remove.',
    }),
    level: Type.Optional(
      Type.Union(
        RECOVERY_LEVELS.map((level) => Type.Literal(level)),
        {
          description:
            "Least departure that can work: repair inside the current scope, replan with a different approach or split, deviate from an acceptance item. Omit for repair.",
        },
      ),
    ),
    cause: text(
      SUBMISSION_LIMITS.cause,
      "Evidence-based cause of the settled failure.",
    ),
    evidence: Type.Array(
      Type.String({ minLength: 1, maxLength: SUBMISSION_LIMITS.evidenceId }),
      {
        minItems: 1,
        maxItems: SUBMISSION_LIMITS.evidence,
        description:
          "Exact failed step IDs from the supplied current evidence; explanations go in cause or strategy.",
      },
    ),
    strategy: text(
      SUBMISSION_LIMITS.strategy,
      "The specific changed approach, or the concrete outside condition. Explanation only; executable repair actions go in work.",
    ),
    work: Type.Array(
      Type.Object(
        {
          title: Type.String({
            minLength: 1,
            maxLength: SUBMISSION_LIMITS.title,
          }),
          instructions: Type.String({
            minLength: 1,
            maxLength: SUBMISSION_LIMITS.instructions,
          }),
          writes: Type.Array(PATH, {
            minItems: 1,
            maxItems: SUBMISSION_LIMITS.writes,
            description:
              "At least one editing path inside the current write scope (plus scope); check-only work items are omitted.",
          }),
        },
        { additionalProperties: false },
      ),
      {
        maxItems: SUBMISSION_LIMITS.work,
        description:
          "Remaining editing assignments. [] only for a safe retry of the original operation.",
      },
    ),
    scope: Type.Optional(
      Type.Array(PATH, {
        maxItems: SUBMISSION_LIMITS.scope,
        description:
          "Further repository paths this decision brings into the write scope (level replan).",
      }),
    ),
    route: Type.Optional(
      Type.Union(
        [
          Type.Null(),
          Type.Object(
            {
              drop: Type.Optional(
                Type.Array(ID, {
                  maxItems: SUBMISSION_LIMITS.routeDrop,
                  description: "IDs of assignments that have not started.",
                }),
              ),
              add: Type.Optional(
                ASSIGNMENT(
                  SUBMISSION_LIMITS.tasks,
                  "New assignments, or a waiting one given again under its own ID to rewrite it.",
                ),
              ),
            },
            { additionalProperties: false },
          ),
        ],
        { description: "Only while assignments are still waiting to start." },
      ),
    ),
    deviation: Type.Optional(
      Type.Union(
        [
          Type.Null(),
          Type.Object(
            {
              item: Type.String({ minLength: 1, maxLength: 2048 }),
              reason: Type.String({
                minLength: 1,
                maxLength: SUBMISSION_LIMITS.deviationField,
              }),
              delivered: Type.String({
                minLength: 1,
                maxLength: SUBMISSION_LIMITS.deviationField,
              }),
              waives: Type.Optional(
                Type.Array(
                  Type.String({
                    minLength: 1,
                    maxLength: SUBMISSION_LIMITS.waive,
                  }),
                  {
                    maxItems: SUBMISSION_LIMITS.documents,
                    description:
                      "Names of declared acceptance checks this sets aside.",
                  },
                ),
              ),
            },
            { additionalProperties: false },
          ),
        ],
        {
          description:
            "Exactly when level is deviate: the acceptance item or decision that cannot be met, the evidence, and what is delivered instead.",
        },
      ),
    ),
    blocker: Type.Optional(
      Type.Union(
        [
          Type.Null(),
          ...RECOVERY_BLOCKERS.map((blocker) => Type.Literal(blocker)),
        ],
        { description: "Named only by a blocked decision." },
      ),
    ),
    completesStage: Type.Optional(
      Type.Boolean({
        description:
          "True only when finishing work fulfills every remaining obligation of the assignment.",
      }),
    ),
  },
  { additionalProperties: false },
);

const only = (input, label, keys) => {
  for (const key of Object.keys(input))
    if (!keys.includes(key))
      throw new Error(
        `${label}: unknown field ${JSON.stringify(key)}; omit it`,
      );
};
const shapeError = (label, why) => new Error(`${label}: ${why}`);
const serialize = (input, label, maximum) => {
  const text = JSON.stringify(input);
  if (Buffer.byteLength(text) > maximum)
    throw shapeError(
      label,
      `the submission exceeds ${maximum} bytes; shorten instructions and cite files instead of pasting them`,
    );
  return text;
};

const nonEmpty = (value, label, why = "cannot be empty") => {
  if (typeof value !== "string" || !value.trim()) throw shapeError(label, why);
};
const checkReadings = (readings, label) => {
  if (readings === undefined) return;
  for (const [i, entry] of readings.entries()) {
    nonEmpty(entry?.reason, `${label}[${i}].reason`);
    if (entry && "path" in entry) {
      nonEmpty(entry.path, `${label}[${i}].path`);
      if (entry.section !== undefined)
        nonEmpty(entry.section, `${label}[${i}].section`);
    } else if (entry && "research" in entry)
      nonEmpty(entry.research, `${label}[${i}].research`);
  }
};
const hasCycle = (tasks) => {
  const remaining = new Map(tasks.map((t) => [t.id, new Set(t.after ?? [])]));
  let progressed = true;
  while (remaining.size && progressed) {
    progressed = false;
    for (const [id, deps] of remaining) {
      if ([...deps].every((dep) => !remaining.has(dep))) {
        remaining.delete(id);
        progressed = true;
      }
    }
  }
  return remaining.size > 0;
};

/** The route plan as the owner will decode it, or a field-named error. */
export function routeSubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw shapeError("route", "expected one object");
  const blocked = input.action === "blocked";
  only(
    input,
    "route",
    blocked
      ? ["action", "reason"]
      : ["tasks", "action", "reviewReads", "documents"],
  );
  if (!blocked && input.action !== undefined && input.action !== "plan")
    throw shapeError("route.action", 'give "plan", "blocked" or omit it');
  if (blocked) {
    if (!input.reason?.trim())
      throw shapeError(
        "route.reason",
        "a blocked plan names concrete source evidence",
      );
    return input;
  }
  const tasks = input.tasks;
  if (!Array.isArray(tasks) || !tasks.length)
    throw shapeError("route.tasks", "a plan needs at least one assignment");
  const ids = tasks.map((task) => task.id);
  for (const [i, task] of tasks.entries()) {
    const label = `tasks[${i}]`;
    nonEmpty(task.title, `${label}.title`);
    nonEmpty(task.instructions, `${label}.instructions`);
    if (!task.writes?.length)
      throw shapeError(
        `${label}.writes`,
        "needs at least one repository-relative path",
      );
    for (const [j, path] of task.writes.entries())
      nonEmpty(path, `${label}.writes[${j}]`);
    if (new Set(task.writes).size !== task.writes.length)
      throw shapeError(`${label}.writes`, "lists a path twice");
    if (ids.indexOf(task.id) !== i)
      throw shapeError(
        `${label}.id`,
        `(${task.id}) is already used by tasks[${ids.indexOf(task.id)}]`,
      );
    const after = task.after ?? [];
    if (new Set(after).size !== after.length)
      throw shapeError(`${label}.after`, "lists an assignment twice");
    const unknown = after.find((dep) => !ids.includes(dep));
    if (unknown !== undefined)
      throw shapeError(`${label}.after`, `"${unknown}" is not in tasks`);
    checkReadings(task.reads, `${label}.reads`);
  }
  if (hasCycle(tasks))
    throw shapeError("route.tasks", "after dependencies form a cycle");
  checkReadings(input.reviewReads, "route.reviewReads");
  if (input.documents !== undefined) {
    for (const [i, doc] of input.documents.entries())
      nonEmpty(doc, `route.documents[${i}]`);
    if (new Set(input.documents).size !== input.documents.length)
      throw shapeError("route.documents", "lists a path twice");
  }
  return input;
}

/** The recovery decision as the owner will decode it, or a field-named error. */
export function recoverySubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw shapeError("recovery", "expected one object");
  only(input, "recovery", [
    "action",
    "level",
    "cause",
    "evidence",
    "strategy",
    "work",
    "scope",
    "route",
    "deviation",
    "blocker",
    "completesStage",
  ]);
  nonEmpty(input.cause, "recovery.cause");
  nonEmpty(input.strategy, "recovery.strategy");
  if (!input.evidence?.length)
    throw shapeError(
      "recovery.evidence",
      "cite at least one exact failed step ID from the supplied evidence",
    );
  if (!Array.isArray(input.work))
    throw shapeError(
      "recovery.work",
      "expected an array of remaining editing assignments",
    );
  for (const [i, item] of input.work.entries()) {
    nonEmpty(item?.title, `recovery.work[${i}].title`);
    nonEmpty(item?.instructions, `recovery.work[${i}].instructions`);
    if (!item?.writes?.length)
      throw shapeError(
        `recovery.work[${i}].writes`,
        "name at least one editing path; omit check-only work items",
      );
  }
  if (input.route) {
    const drop = input.route.drop ?? [];
    const add = input.route.add ?? [];
    if (!drop.length && !add.length)
      throw shapeError(
        "recovery.route",
        "a route revision drops or adds at least one assignment",
      );
    for (const [i, task] of add.entries()) {
      const label = `recovery.route.add[${i}]`;
      nonEmpty(task?.title, `${label}.title`);
      nonEmpty(task?.instructions, `${label}.instructions`);
      if (!task?.writes?.length)
        throw shapeError(
          `${label}.writes`,
          "needs at least one repository-relative path",
        );
      if (new Set(task.writes).size !== task.writes.length)
        throw shapeError(`${label}.writes`, "lists a path twice");
      if (new Set(task.after ?? []).size !== (task.after ?? []).length)
        throw shapeError(`${label}.after`, "lists an assignment twice");
    }
  }
  const level = input.level ?? "repair";
  if ((level === "deviate") !== Boolean(input.deviation))
    throw shapeError(
      level === "deviate" ? "recovery.deviation" : "recovery.level",
      'a deviation is recorded exactly when level is "deviate"',
    );
  if (input.deviation) {
    nonEmpty(input.deviation.item, "recovery.deviation.item");
    nonEmpty(input.deviation.reason, "recovery.deviation.reason");
    nonEmpty(input.deviation.delivered, "recovery.deviation.delivered");
  }
  if (input.action === "blocked") {
    if (!input.blocker)
      throw shapeError(
        "recovery.blocker",
        "a blocked decision names the outside condition",
      );
    if (
      input.work.length ||
      input.scope?.length ||
      input.route ||
      input.deviation
    )
      throw shapeError(
        "recovery",
        "a blocked decision cannot dispatch work; give blocker, cause, evidence and strategy only",
      );
  } else if (input.blocker)
    throw shapeError(
      "recovery.blocker",
      "only a blocked decision names a blocker",
    );
  return input;
}

/** The submission tools, one per readonly structured role. */
export function createSubmissionTools() {
  return [
    {
      name: "cadence_route",
      label: "Submit the route plan",
      description:
        "Submit the complete route plan once, after inspecting the agreement and the repository. The parameters state the required shape and bounds; a refused call names the field to fix, and you may call it again with the correction. Your final answer may then be a brief summary; no JSON formatting is required in it.",
      parameters: ROUTE_PLAN_PARAMETERS,
      async execute(_id, input) {
        const text = serialize(
          routeSubmission(input),
          "route",
          SUBMISSION_LIMITS.routeBytes,
        );
        return {
          content: [{ type: "text", text: "Route plan submitted." }],
          details: JSON.parse(text),
        };
      },
    },
    {
      name: "cadence_recovery",
      label: "Submit the recovery decision",
      description:
        "Submit the recovery decision once, after diagnosing the settled failure from actual files and the supplied native facts. The parameters state the required shape and bounds; a refused call names the field to fix, and you may call it again with the correction. Your final answer may then be a brief summary; no JSON formatting is required in it.",
      parameters: RECOVERY_PARAMETERS,
      async execute(_id, input) {
        const text = serialize(
          recoverySubmission(input),
          "recovery",
          SUBMISSION_LIMITS.recoveryBytes,
        );
        return {
          content: [{ type: "text", text: "Recovery decision submitted." }],
          details: JSON.parse(text),
        };
      },
    },
  ];
}
