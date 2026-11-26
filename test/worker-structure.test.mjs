/** Structured readonly submissions: the SDK refuses a malformed call in-session
 * with the field at fault, the tool serializes what it accepts, and the owner's
 * contract remains the gate. The schema's bounds are pinned to the contract's. */
import { randomUUID } from "node:crypto";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { WORKFLOW_LIMITS } from "../src/service/contracts/workflow.ts";
import {
  decodeRecoveryDecision,
  decodeRoutePlan,
  InvalidRoute,
  RECOVERY_BYTES,
  ROUTE_PLAN_BYTES,
} from "../src/service/workflow-controller.ts";
import {
  createSubmissionTools,
  RECOVERY_PARAMETERS,
  ROUTE_PLAN_PARAMETERS,
  SUBMISSION_LIMITS,
} from "../src/worker-toolkit.mjs";

const [route, recovery] = createSubmissionTools();
const task = (id, extra = {}) => ({
  id,
  title: "Title",
  instructions: "Instructions",
  writes: ["src/a.ts"],
  ...extra,
});
const call = (tool, args, argumentsError) =>
  validateToolArguments(tool, {
    type: "toolCall",
    id: "call",
    name: tool.name,
    arguments: args,
    ...(argumentsError ? { argumentsError } : {}),
  });

it("the three shapes that ended a real delivery are refused in-session with the field at fault", () => {
  // reviewReads: has 20 entries; at most 16 — a cold re-ask before, one turn now.
  expect(() =>
    call(route, {
      tasks: [task("a")],
      reviewReads: Array.from({ length: 20 }, (_, i) => ({
        path: `src/f${i}.ts`,
        reason: "Why",
      })),
    }),
  ).toThrow(/reviewReads.*at most 16/);
  // A task ID with uppercase letters, used as a worktree name.
  expect(() =>
    call(route, { tasks: [task("command-port-commandId-type")] }),
  ).toThrow(/tasks\.0\.id.*\^\[a-z\]\[a-z0-9-\]/);
  // A provider that could not parse the arguments JSON at all.
  expect(() => call(route, {}, "Unexpected token '}': not valid JSON")).toThrow(
    /Invalid arguments for tool "cadence_route"/,
  );
  expect(() => call(route, { tasks: [task("a")], command: "skip" })).toThrow(
    /command: unknown field/,
  );
  // What the schema admits, the tool passes through untouched.
  const plan = {
    tasks: [
      task("core", {
        reads: [{ research: randomUUID(), reason: "Prior" }],
      }),
    ],
    reviewReads: [
      { path: "AGENTS.md", section: "Development", reason: "Rules" },
    ],
    documents: ["docs/guide.md"],
  };
  expect(call(route, plan)).toEqual(plan);
});

it("what the tool accepts, the owner decodes: the tool's own serialization is the submission", async () => {
  const investigation = randomUUID();
  const plan = {
    tasks: [
      task("core", {
        after: [],
        reads: [{ research: investigation, reason: "Prior evidence" }],
      }),
      task("tests", { after: ["core"] }),
    ],
    reviewReads: [{ path: "AGENTS.md", reason: "House rules" }],
    documents: ["docs/guide.md"],
  };
  const accepted = call(route, plan);
  const result = await route.execute("c", accepted);
  const submission = result.content[0].text;
  expect(JSON.parse(submission)).toEqual(plan);
  expect(
    decodeRoutePlan(submission, {
      agreementDocuments: [],
      buildOutputs: [],
    }).tasks.map((t) => t.id),
  ).toEqual(["core", "tests"]);
  // An explicit "plan" action is the same plan: the schema allows it, the
  // tool accepts it and the owner decodes it, so no objection loop starts.
  const explicit = { action: "plan", tasks: [task("core")] };
  const explicitSubmission = (await route.execute("c", call(route, explicit)))
    .content[0].text;
  expect(JSON.parse(explicitSubmission)).toEqual(explicit);
  expect(decodeRoutePlan(explicitSubmission).action).toBe("plan");
  const blocked = await route.execute("c", {
    action: "blocked",
    reason: "Immutable public API",
  });
  expect(decodeRoutePlan(blocked.content[0].text)).toMatchObject({
    action: "blocked",
    reason: "Immutable public API",
  });
});

it("the route schema states the bounds the owner contract enforces", () => {
  const props = ROUTE_PLAN_PARAMETERS.properties;
  expect(props.tasks.maxItems).toBe(WORKFLOW_LIMITS.tasks);
  expect(props.reviewReads.maxItems).toBe(SUBMISSION_LIMITS.readings);
  expect(props.documents.maxItems).toBe(SUBMISSION_LIMITS.documents);
  const taskProps = props.tasks.items.properties;
  expect(taskProps.writes.maxItems).toBe(SUBMISSION_LIMITS.writes);
  expect(taskProps.id.pattern).toBe(
    `^[a-z][a-z0-9-]{0,${SUBMISSION_LIMITS.idLength - 1}}$`,
  );
  expect(taskProps.title.maxLength).toBe(SUBMISSION_LIMITS.title);
  expect(taskProps.instructions.maxLength).toBe(SUBMISSION_LIMITS.instructions);
  expect(SUBMISSION_LIMITS.routeBytes).toBe(ROUTE_PLAN_BYTES);
  // The contract refuses exactly these; the model sees them before calling.
  const many = (n) => Array.from({ length: n }, (_, i) => task(`t${i}`));
  expect(() => decodeRoutePlan(JSON.stringify({ tasks: many(17) }))).toThrow(
    InvalidRoute,
  );
  expect(() =>
    decodeRoutePlan(
      JSON.stringify({
        tasks: [task("a")],
        reviewReads: Array.from({ length: 17 }, () => ({
          path: "src/a.ts",
          reason: "Why",
        })),
      }),
    ),
  ).toThrow(/at most 16/);
  expect(() =>
    decodeRoutePlan(JSON.stringify({ tasks: [task("a".repeat(49))] })),
  ).toThrow(/at most 48 characters/);
  expect(() =>
    decodeRoutePlan(
      JSON.stringify({
        tasks: [task("a", { instructions: "x".repeat(8193) })],
      }),
    ),
  ).toThrow(/8192/);
});

it("the recovery schema states the bounds the owner contract enforces", () => {
  const props = RECOVERY_PARAMETERS.properties;
  expect(props.evidence.maxItems).toBe(SUBMISSION_LIMITS.evidence);
  expect(props.evidence.items.maxLength).toBe(SUBMISSION_LIMITS.evidenceId);
  expect(props.scope.maxItems).toBe(SUBMISSION_LIMITS.scope);
  expect(props.work.maxItems).toBe(SUBMISSION_LIMITS.work);
  expect(props.cause.maxLength).toBe(SUBMISSION_LIMITS.cause);
  expect(props.strategy.maxLength).toBe(SUBMISSION_LIMITS.strategy);
  expect(SUBMISSION_LIMITS.recoveryBytes).toBe(RECOVERY_BYTES);
  const routeObject = props.route.anyOf[1];
  expect(routeObject.properties.drop.maxItems).toBe(WORKFLOW_LIMITS.route);
  expect(routeObject.properties.add.maxItems).toBe(WORKFLOW_LIMITS.tasks);
  const deviation = props.deviation.anyOf[1];
  expect(deviation.properties.reason.maxLength).toBe(
    SUBMISSION_LIMITS.deviationField,
  );
  expect(deviation.properties.waives.maxItems).toBe(
    SUBMISSION_LIMITS.documents,
  );
  expect(props.blocker.anyOf.map((b) => b.const ?? b.type)).toEqual([
    "null",
    "model",
    "authentication",
    "storage",
    "installation",
    "tool",
  ]);
  const step = `step-${randomUUID()}`;
  const decision = {
    action: "continue",
    cause: "Cause",
    evidence: [step],
    strategy: "Strategy",
    work: [{ title: "Repair", instructions: "Fix", writes: ["src/a.ts"] }],
  };
  const bounds = {
    scope: ["src"],
    evidence: [step],
    floor: "repair",
    checks: [],
  };
  expect(call(recovery, decision)).toEqual(decision);
  expect(
    decodeRecoveryDecision(JSON.stringify(decision), bounds),
  ).toMatchObject({ action: "continue", level: "repair" });
  expect(() =>
    call(recovery, {
      ...decision,
      evidence: Array.from({ length: 33 }, () => step),
    }),
  ).toThrow(/evidence.*at most 32/);
  expect(() => call(recovery, { ...decision, blocker: "model" })).not.toThrow();
  expect(() => call(recovery, { ...decision, level: "retry" })).toThrow(
    /level/,
  );
});
