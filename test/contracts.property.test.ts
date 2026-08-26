import { describe, expect, it } from "vitest";
import type { PhaseAttempt, TaskBoundary } from "../src/contracts";
import {
  graphAdmissionFor,
  type ImplementTaskFixture,
  taskAttemptFor,
} from "./helpers/implement-graph-fixture.ts";

let contracts: typeof import("../src/contracts") | null = null;
try {
  contracts = await import("../src/contracts");
} catch {
  contracts = null;
}

const notReady = (what: string) => {
  expect.fail(`not_ready: ${what} is not implemented`);
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function validEnvelope(overrides = {}) {
  return {
    stage: "abel-design",
    role: "design-explorer",
    id: "packet-001",
    phase: "evidence",
    objective: "Inspect the layout of src/",
    roots: ["src"],
    context: { agents: "## AGENTS excerpt", contract: "## approved contract" },
    declared: {
      read: [],
      write: [],
      conflicts: [],
      resources: [],
      verificationLock: undefined,
    },
    output: "evidence",
    ...overrides,
  };
}

function validTaskBoundary(): TaskBoundary {
  const testFile = "test/contracts.property.test.ts";
  const verificationInputs = [
    { kind: "workspace" as const, path: testFile },
    { kind: "workspace" as const, path: "package.json" },
  ];
  return {
    changeId: "remove-implement-design-loop",
    taskId: "S1",
    dependsOn: [],
    objective: "Replace repeated Implement envelopes with one task boundary",
    context: {
      agents: "bounded package context",
      contract: "approved immutable task contract",
    },
    roots: ["."],
    phases: {
      red: {
        read: ["src/contracts.ts", testFile, "package.json"],
        write: [testFile],
        verification: {
          kind: "vitest",
          id: "verify-s1-red",
          runner: {
            kind: "package-script",
            packageManager: "bun",
            script: "test:target",
            command: "vitest run",
          },
          testFiles: [testFile],
          args: [],
          classification: "expected-red",
          expectedFailure: "[SLICE-1:boundary-once]",
          minTests: 1,
        },
        verificationInputs,
        verificationLock: "vitest-implement-runtime",
      },
      green: {
        read: ["src/contracts.ts", testFile, "package.json"],
        write: ["src/contracts.ts"],
        verification: {
          kind: "vitest",
          id: "verify-s1-green",
          runner: {
            kind: "package-script",
            packageManager: "bun",
            script: "test:target",
            command: "vitest run",
          },
          testFiles: [testFile],
          args: [],
          classification: "expected-green",
          minTests: 1,
        },
        verificationInputs,
        verificationLock: "vitest-implement-runtime",
      },
    },
    scheduling: {
      conflicts: ["S2"],
      resources: ["implement-runtime-core"],
    },
    agents: {
      impact: "none",
      managedOnly: true,
    },
    approvedDependencies: [] as string[],
    impactClosure: {
      changedSurfaces: ["none"],
      searchEvidence: [],
      relatedTests: [
        {
          path: "test/contracts.property.test.ts",
          disposition: "current-task",
          evidence: "S1 Red owns the strict request contract.",
        },
      ],
      affectedSuite: ["test/contracts.property.test.ts"],
    },
  };
}

function phaseAttempt(
  phase: "red" | "green" | "refactor" = "red",
  requestId = `S1:${phase}:0`,
): PhaseAttempt {
  const paths =
    phase === "red"
      ? ["src/contracts.ts", "test/contracts.property.test.ts", "package.json"]
      : ["src/contracts.ts", "test/contracts.property.test.ts", "package.json"];
  return {
    changeId: "remove-implement-design-loop",
    taskId: "S1",
    requestId,
    phase,
    snapshot: Object.fromEntries(
      paths.map((path) => [
        path,
        { kind: "file", sha256: "a".repeat(64), bytes: 1 },
      ]),
    ),
  };
}

function openTaskRequest(): ImplementTaskFixture {
  return {
    boundary: validTaskBoundary(),
    attempt: phaseAttempt(),
  };
}

function validImplementFixture(fixture: ImplementTaskFixture): boolean {
  if (!contracts) return false;
  return (
    contracts.validateRequestEnvelope(graphAdmissionFor([fixture])).ok &&
    contracts.validateRequestEnvelope(taskAttemptFor(fixture)).ok &&
    contracts.validatePhaseAttemptAgainstBoundary(
      fixture.boundary,
      fixture.attempt,
    ) === null
  );
}

const REQUIRED_FIELDS = [
  "stage",
  "role",
  "id",
  "phase",
  "objective",
  "roots",
  "output",
];

describe("strict request envelope contracts", () => {
  it("[SLICE-1:boundary-once] accepts only the strict Implement run union", () => {
    if (!contracts) return notReady("contracts");
    const fixture = openTaskRequest();
    expect(
      contracts.validateRequestEnvelope(graphAdmissionFor([fixture])).ok,
    ).toBe(true);
    expect(
      contracts.validateRequestEnvelope(
        taskAttemptFor({ ...fixture, attempt: phaseAttempt("green") }),
      ).ok,
    ).toBe(true);

    const repeatedBoundary = {
      stage: "abel-implement",
      kind: "task-attempt",
      boundary: validTaskBoundary(),
      attempt: phaseAttempt("green"),
    };
    expect(contracts.validateRequestEnvelope(repeatedBoundary).ok).toBe(false);

    expect(
      contracts.validateRequestEnvelope({
        stage: "abel-implement",
        kind: "unknown-run-kind",
        boundary: validTaskBoundary(),
        attempt: phaseAttempt(),
      }).ok,
    ).toBe(false);
  });

  it("[SLICE-1:boundary-once] rejects stable facts on phase attempts", () => {
    if (!contracts) return notReady("contracts");
    const stableFacts: Array<[string, unknown]> = [
      ["objective", "replayed objective"],
      ["context", { agents: "replayed", contract: "replayed" }],
      ["roots", ["."]],
      ["phases", validTaskBoundary().phases],
      ["scheduling", validTaskBoundary().scheduling],
      ["agents", validTaskBoundary().agents],
      ["approvedDependencies", []],
      ["impactClosure", validTaskBoundary().impactClosure],
      ["verification", validTaskBoundary().phases.green.verification],
      ["evidence", ["caller verification"]],
      ["role", "implementation-worker"],
      ["output", "diff"],
    ];

    for (const [field, value] of stableFacts) {
      const request = {
        stage: "abel-implement",
        kind: "task-attempt",
        attempt: {
          ...phaseAttempt("green"),
          [field]: value,
        },
      };
      expect(
        contracts.validateRequestEnvelope(request).ok,
        `${field} must not be replayed`,
      ).toBe(false);
    }
  });

  it("[SLICE-1:boundary-once] rejects duplicate or overlapping roots and set members", () => {
    if (!contracts) return notReady("contracts");
    const invalidBoundaries: Array<
      [string, (boundary: ReturnType<typeof validTaskBoundary>) => void]
    > = [
      ["duplicate roots", (boundary) => (boundary.roots = ["src", "src"])],
      [
        "overlapping roots",
        (boundary) => (boundary.roots = ["src", "src/runtime"]),
      ],
      [
        "duplicate reads",
        (boundary) =>
          boundary.phases.red.read.push(boundary.phases.red.read[0]),
      ],
      [
        "duplicate writes",
        (boundary) =>
          boundary.phases.red.write.push(boundary.phases.red.write[0]),
      ],
      [
        "duplicate conflicts",
        (boundary) =>
          boundary.scheduling.conflicts.push(boundary.scheduling.conflicts[0]),
      ],
      [
        "duplicate resources",
        (boundary) =>
          boundary.scheduling.resources.push(boundary.scheduling.resources[0]),
      ],
      [
        "duplicate dependencies",
        (boundary) => boundary.approvedDependencies.push("vitest", "vitest"),
      ],
      [
        "duplicate impact surfaces",
        (boundary) => boundary.impactClosure.changedSurfaces.push("none"),
      ],
      [
        "duplicate affected tests",
        (boundary) =>
          boundary.impactClosure.affectedSuite.push(
            boundary.impactClosure.affectedSuite[0],
          ),
      ],
    ];

    for (const [label, mutate] of invalidBoundaries) {
      const request = openTaskRequest();
      mutate(request.boundary);
      expect(validImplementFixture(request), `${label} must fail closed`).toBe(
        false,
      );
    }
  });

  it("[SLICE-1:boundary-once] contains every phase path within an approved root", () => {
    if (!contracts) return notReady("contracts");
    const request = openTaskRequest();
    request.boundary.roots = ["src", "test", "package.json"];
    for (const phase of [
      request.boundary.phases.red,
      request.boundary.phases.green,
    ]) {
      phase.read = [
        "src/contracts.ts",
        "test/contracts.property.test.ts",
        "package.json",
      ];
      phase.write = ["src/contracts.ts"];
    }
    request.boundary.impactClosure = {
      changedSurfaces: ["none"],
      searchEvidence: [],
      relatedTests: [],
      affectedSuite: [],
    };
    request.attempt.snapshot = {
      "src/contracts.ts": {
        kind: "file",
        sha256: "a".repeat(64),
        bytes: 1,
      },
      "test/contracts.property.test.ts": {
        kind: "file",
        sha256: "c".repeat(64),
        bytes: 1,
      },
      "package.json": {
        kind: "file",
        sha256: "d".repeat(64),
        bytes: 1,
      },
    };
    expect(validImplementFixture(request)).toBe(true);

    request.boundary.phases.red.write = ["outside.ts"];
    request.attempt.snapshot = {
      "src/contracts.ts": {
        kind: "file",
        sha256: "a".repeat(64),
        bytes: 1,
      },
      "outside.ts": {
        kind: "file",
        sha256: "b".repeat(64),
        bytes: 1,
      },
      "test/contracts.property.test.ts": {
        kind: "file",
        sha256: "c".repeat(64),
        bytes: 1,
      },
      "package.json": {
        kind: "file",
        sha256: "d".repeat(64),
        bytes: 1,
      },
    };
    expect(validImplementFixture(request)).toBe(false);
  });

  it("[SLICE-1:boundary-once] requires regular-file or absent write bounds", () => {
    if (!contracts) return notReady("contracts");
    const request = openTaskRequest();
    (request.attempt.snapshot as Record<string, unknown>)[
      "test/contracts.property.test.ts"
    ] = {
      kind: "dir",
      manifest: "b".repeat(64),
    };

    expect(
      contracts.validatePhaseAttemptAgainstBoundary(
        request.boundary,
        request.attempt,
      ),
    ).not.toBeNull();
  });

  it("[SLICE-1:boundary-once] rejects nested TaskBoundary and snapshot fields", () => {
    if (!contracts) return notReady("contracts");
    const mutations: Array<
      [string, (request: ReturnType<typeof openTaskRequest>) => void]
    > = [
      [
        "verification",
        (request) => {
          (
            request.boundary.phases.red.verification as unknown as Record<
              string,
              unknown
            >
          ).evidence = ["hidden instruction"];
        },
      ],
      [
        "impact closure",
        (request) => {
          (
            request.boundary.impactClosure as unknown as Record<string, unknown>
          ).nextStep = "hidden";
        },
      ],
      [
        "related test",
        (request) => {
          (
            request.boundary.impactClosure.relatedTests[0] as unknown as Record<
              string,
              unknown
            >
          ).nextStep = "hidden";
        },
      ],
      [
        "snapshot entry",
        (request) => {
          (
            (request.attempt.snapshot as Record<string, unknown>)[
              "src/contracts.ts"
            ] as Record<string, unknown>
          ).mode = "100644";
        },
      ],
    ];

    for (const [label, mutate] of mutations) {
      const request = openTaskRequest();
      mutate(request);
      expect(validImplementFixture(request), `${label} must fail closed`).toBe(
        false,
      );
    }
  });

  it("[SLICE-1:boundary-once] keeps Design and Diagnose run envelopes valid", () => {
    if (!contracts) return notReady("contracts");
    expect(contracts.validateRequestEnvelope(validEnvelope()).ok).toBe(true);
    expect(
      contracts.validateRequestEnvelope(
        validEnvelope({
          stage: "abel-diagnose",
          role: "diagnosis-worker",
          id: "diagnose-001",
          phase: "red",
          objective: "Diagnose the bounded regression",
          output: "diff",
        }),
      ).ok,
    ).toBe(true);
  });

  it("accepts a valid evidence envelope", () => {
    if (!contracts) return notReady("contracts");
    const result = contracts.validateRequestEnvelope(validEnvelope());
    expect(result.ok).toBe(true);
  });

  it("rejects an empty envelope", () => {
    if (!contracts) return notReady("contracts");
    expect(contracts.validateRequestEnvelope({}).ok).toBe(false);
    expect(contracts.validateRequestEnvelope(null).ok).toBe(false);
    expect(contracts.validateRequestEnvelope(undefined).ok).toBe(false);
  });

  it("rejects envelopes missing any required field", () => {
    if (!contracts) return notReady("contracts");
    for (const field of REQUIRED_FIELDS) {
      const env = validEnvelope() as Record<string, unknown>;
      delete env[field];
      const result = contracts.validateRequestEnvelope(env);
      expect(result.ok, `missing ${field} must be rejected`).toBe(false);
      expect((result as { ok: false; reason: string }).reason).toMatch(
        /missing|required/i,
      );
    }
  });

  it("rejects unknown stages and roles", () => {
    if (!contracts) return notReady("contracts");
    expect(
      contracts.validateRequestEnvelope(validEnvelope({ stage: "abel-init" }))
        .ok,
    ).toBe(false);
    expect(
      contracts.validateRequestEnvelope(validEnvelope({ stage: "unknown" })).ok,
    ).toBe(false);
    expect(
      contracts.validateRequestEnvelope(validEnvelope({ role: "random-agent" }))
        .ok,
    ).toBe(false);
  });

  it("rejects envelopes over the 64 KiB serialized limit", () => {
    if (!contracts) return notReady("contracts");
    const big = validEnvelope({ objective: "x".repeat(70 * 1024) });
    const result = contracts.validateRequestEnvelope(big);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(
      /64|limit|kib|large/i,
    );
  });

  it("rejects path bounds that escape or are absolute", () => {
    if (!contracts) return notReady("contracts");
    for (const root of ["/etc", "..", "../src", "src/../../etc"]) {
      const result = contracts.validateRequestEnvelope(
        validEnvelope({ roots: [root] }),
      );
      expect(result.ok, `root ${root} must be rejected`).toBe(false);
    }
    const env = validEnvelope() as Record<string, unknown>;
    (env.declared as { write: string[] }).write = ["/tmp/out.patch"];
    expect(contracts.validateRequestEnvelope(env).ok).toBe(false);
  });

  it("rejects equivalent noncanonical path spellings before scheduling", () => {
    if (!contracts) return notReady("contracts");
    expect(contracts.isValidRelativePath(".")).toBe(true);
    for (const path of ["./src/a.ts", "src/./a.ts", "src/"]) {
      expect(
        contracts.isValidRelativePath(path),
        `${path} must not alias a canonical declaration`,
      ).toBe(false);

      const design = validEnvelope();
      (design.declared as { read: string[] }).read = [path];
      expect(
        contracts.validateRequestEnvelope(design).ok,
        `Design declaration ${path} must fail closed`,
      ).toBe(false);

      const implementation = openTaskRequest();
      implementation.boundary.phases.red.read = [path];
      expect(
        validImplementFixture(implementation),
        `Implement declaration ${path} must fail closed`,
      ).toBe(false);
    }
  });

  it("requires phase-matched verification for every implementation diff", () => {
    if (!contracts) return notReady("contracts");
    const implementation = openTaskRequest();
    (implementation.boundary.phases as Record<string, unknown>).refactor = {
      read: [
        "src/contracts.ts",
        "test/contracts.property.test.ts",
        "package.json",
      ],
      write: ["src/contracts.ts"],
      verificationLock: "vitest-implement-runtime",
      verification: {
        kind: "vitest",
        id: "verify-refactor",
        runner: {
          kind: "package-script",
          packageManager: "bun",
          script: "test:target",
          command: "vitest run",
        },
        testFiles: ["test/contracts.property.test.ts"],
        args: [],
        classification: "expected-refactor",
        minTests: 1,
      },
      verificationInputs: [
        { kind: "workspace", path: "test/contracts.property.test.ts" },
        { kind: "workspace", path: "package.json" },
      ],
    };
    expect(validImplementFixture(implementation)).toBe(true);

    for (const phase of ["red", "green", "refactor"] as const) {
      const missing = structuredClone(implementation);
      delete (
        missing.boundary.phases[phase] as unknown as Record<string, unknown>
      ).verification;
      expect(validImplementFixture(missing)).toBe(false);

      const mismatched = structuredClone(implementation);
      const verification = mismatched.boundary.phases[phase]!
        .verification as unknown as Record<string, unknown>;
      verification.classification =
        phase === "red" ? "expected-green" : "expected-red";
      delete verification.expectedFailure;
      expect(validImplementFixture(mismatched)).toBe(false);
    }

    const missingTask = structuredClone(implementation) as unknown as {
      boundary: Record<string, unknown>;
    };
    delete missingTask.boundary.taskId;
    expect(
      contracts.validateRequestEnvelope(
        graphAdmissionFor([missingTask as unknown as ImplementTaskFixture]),
      ).ok,
    ).toBe(false);
  });

  it("accepts only structured cross-project verification kinds and safe runners", () => {
    if (!contracts) return notReady("contracts");
    const common = {
      id: "consumer-verification",
      classification: "expected-green",
    } as const;
    const supported = [
      {
        ...common,
        kind: "vitest",
        runner: {
          kind: "package-script",
          packageManager: "npm",
          script: "test:run",
          command: "vitest run",
        },
        testFiles: ["tests/utils/upstreamFetch.test.js"],
        args: [],
        minTests: 1,
      },
      {
        ...common,
        kind: "package-script",
        packageManager: "npm",
        script: "typecheck",
        command: "tsc --noEmit",
        args: [],
      },
      {
        ...common,
        kind: "static-check",
        runner: { kind: "node", script: "scripts/check-agents.mjs" },
        args: [],
      },
      {
        ...common,
        kind: "static-check",
        runner: { kind: "npx", executable: "prisma", noInstall: true },
        args: ["validate"],
      },
      {
        ...common,
        kind: "steps",
        steps: [
          {
            id: "typecheck-first",
            kind: "package-script",
            packageManager: "npm",
            script: "typecheck",
            command: "tsc --noEmit",
            args: [],
            classification: "expected-green",
          },
          {
            id: "target",
            kind: "vitest",
            runner: {
              kind: "package-script",
              packageManager: "npm",
              script: "test:run",
              command: "vitest run",
            },
            testFiles: ["tests/utils/upstreamFetch.test.js"],
            args: [],
            minTests: 1,
            classification: "expected-green",
          },
        ],
      },
    ];
    for (const verification of supported) {
      expect(
        contracts.validateVerificationContract(verification),
        JSON.stringify(verification),
      ).toMatchObject({ ok: true });
    }

    for (const verification of [
      {
        ...supported[0],
        testFiles: ["../outside.test.ts"],
      },
      {
        ...supported[0],
        args: ["--config=/tmp/outside.ts"],
      },
      {
        ...supported[0],
        args: ["--dir=../outside"],
      },
      {
        ...supported[0],
        runner: { kind: "local-binary", executable: "jest" },
      },
      {
        ...supported[0],
        runner: {
          kind: "package-script",
          packageManager: "npm",
          script: "test:run",
          command: "jest --run",
        },
      },
      {
        ...supported[1],
        args: ["&&", "node", "outside.js"],
      },
      {
        ...supported[2],
        runner: { kind: "node", script: "/tmp/outside.mjs" },
      },
      {
        ...supported[3],
        runner: { kind: "npx", executable: "prisma", noInstall: false },
      },
    ]) {
      expect(
        contracts.validateVerificationContract(verification),
        JSON.stringify(verification),
      ).toMatchObject({ ok: false });
    }
  });

  it("rejects legacy argv verification contracts", () => {
    if (!contracts) return notReady("contracts");
    for (const argv of [
      ["bun", "run", "test:target", "test/legacy.test.ts"],
      ["bun", "run", "check"],
    ]) {
      expect(
        contracts.validateVerificationContract({
          id: "legacy-contract",
          argv,
          classification: "expected-green",
          minTests: 1,
        }),
      ).toMatchObject({ ok: false });
    }
  });

  it("requires a mechanical AGENTS impact contract and never delegates AGENTS writes", () => {
    if (!contracts) return notReady("contracts");
    const implementation = openTaskRequest();
    implementation.boundary.agents = {
      impact: "update-existing",
      target: "AGENTS.md",
      managedOnly: true,
    };

    expect(validImplementFixture(implementation)).toBe(true);

    const missing = structuredClone(implementation);
    delete (missing.boundary.agents as Record<string, unknown>).impact;
    expect(validImplementFixture(missing)).toBe(false);

    const noneWithTarget = structuredClone(implementation);
    noneWithTarget.boundary.agents.impact = "none";
    expect(validImplementFixture(noneWithTarget)).toBe(false);

    for (const impact of [
      "none",
      "update-existing",
      "create-index",
      "remove-index",
    ] as const) {
      const delegated = structuredClone(implementation);
      delegated.boundary.agents.impact = impact;
      if (impact === "none") delete delegated.boundary.agents.target;
      delegated.boundary.phases.green.write.push("AGENTS.md");
      expect(
        validImplementFixture(delegated),
        `${impact} must not grant a child AGENTS write`,
      ).toBe(false);
    }

    const designWrite = validEnvelope({
      declared: {
        read: [],
        write: ["AGENTS.md"],
        conflicts: [],
        resources: [],
      },
    });
    expect(contracts.validateRequestEnvelope(designWrite).ok).toBe(false);
  });

  it("requires existing-test impact closure for public route and authorization changes", () => {
    if (!contracts) return notReady("contracts");
    const routeTask = openTaskRequest();
    for (const phase of [
      routeTask.boundary.phases.red,
      routeTask.boundary.phases.green,
    ]) {
      phase.read = [
        "src/index.ts",
        "test/contracts.property.test.ts",
        "package.json",
      ];
      phase.write = ["src/index.ts"];
    }
    routeTask.attempt.snapshot = {
      "src/index.ts": {
        kind: "file",
        sha256: "a".repeat(64),
        bytes: 1,
      },
      "test/contracts.property.test.ts": {
        kind: "file",
        sha256: "b".repeat(64),
        bytes: 1,
      },
      "package.json": {
        kind: "file",
        sha256: "c".repeat(64),
        bytes: 1,
      },
    };
    routeTask.boundary.impactClosure = {
      changedSurfaces: ["route-authorization", "api-response"],
      searchEvidence: ["rg -n '/videos|/api/videos' tests test templates src"],
      relatedTests: [
        {
          path: "test/contracts.property.test.ts",
          disposition: "unaffected",
          evidence:
            "Existing route contract remains valid under the approved policy.",
        },
      ],
      affectedSuite: ["test/contracts.property.test.ts"],
    };

    expect(validImplementFixture(routeTask)).toBe(true);

    const newTestOnly = structuredClone(routeTask);
    for (const phase of [
      newTestOnly.boundary.phases.red,
      newTestOnly.boundary.phases.green,
    ]) {
      phase.read = ["src/index.ts"];
      phase.write = ["src/index.ts", "test/new-videos-route.test.ts"];
    }
    newTestOnly.attempt.snapshot = {
      "src/index.ts": {
        kind: "file",
        sha256: "a".repeat(64),
        bytes: 1,
      },
      "test/new-videos-route.test.ts": { kind: "absent", absent: true },
    };
    newTestOnly.boundary.impactClosure = {
      changedSurfaces: ["route-authorization"],
      searchEvidence: ["rg -n '/videos' test tests"],
      relatedTests: [
        {
          path: "test/new-videos-route.test.ts",
          disposition: "current-task",
          evidence: "new authorization test",
        },
      ],
      affectedSuite: ["test/new-videos-route.test.ts"],
    };
    expect(validImplementFixture(newTestOnly)).toBe(false);
  });

  it("requires explicit targets for index creation and removal", () => {
    if (!contracts) return notReady("contracts");
    for (const impact of ["create-index", "remove-index"] as const) {
      const request = openTaskRequest();
      request.boundary.agents.impact = impact;
      expect(validImplementFixture(request)).toBe(false);
    }
  });

  it("extracts write paths from ordinary unified diff headers", () => {
    if (!contracts) return notReady("contracts");
    const diff = [
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1 +1,2 @@",
      " old",
      "+new",
      "--- a/test/x.test.ts",
      "+++ b/test/x.test.ts",
      "@@ -5,2 +5,2 @@",
      " a",
      " b",
      "",
    ].join("\n");
    const { paths } = contracts.diffWritePaths(diff);
    expect(paths).toEqual(["src/index.ts", "test/x.test.ts"]);
  });

  it("rejects binary, rename, mode, submodule, and escaping diff headers", () => {
    if (!contracts) return notReady("contracts");
    const bad = [
      ["GIT binary patch\nliteral 0", /binary/i],
      [
        "--- a/src/a.ts\n+++ b/src/b.ts\nrename from src/a.ts\nrename to src/b.ts",
        /rename/i,
      ],
      [
        "--- a/src/a.ts\n+++ b/src/a.ts\nold mode 100644\nnew mode 100755",
        /mode/i,
      ],
      [
        "--- a/src/a.ts\n+++ b/src/a.ts\nnew file mode 160000",
        /submodule|160000/i,
      ],
      ["--- a/../escape.ts\n+++ b/../escape.ts", /escape|\.\.|noncanonical/i],
    ];
    for (const [text, pattern] of bad) {
      expect(
        () => contracts.diffWritePaths(text as string),
        `must reject: ${String(pattern)}`,
      ).toThrow(pattern as RegExp);
    }
  });
});

describe("generated envelope fuzzing with a fixed seed", () => {
  it("never accepts structurally invalid generated envelopes", () => {
    if (!contracts) return notReady("contracts");
    const rand = mulberry32(0xabe1);
    for (let i = 0; i < 200; i++) {
      const env = validEnvelope() as Record<string, unknown>;
      if (rand() < 0.3) env.stage = `abel-${rand() < 0.5 ? "init" : "unknown"}`;
      if (rand() < 0.3) env.role = "random-agent";
      if (rand() < 0.3) delete env.id;
      if (rand() < 0.3) env.objective = "";
      const result = contracts.validateRequestEnvelope(env);
      const mutated =
        env.stage !== "abel-design" ||
        env.role !== "design-explorer" ||
        !env.id ||
        !env.objective;
      if (mutated) {
        expect(result.ok, `fuzz case ${i} must be rejected`).toBe(false);
      } else {
        expect(result.ok, `fuzz case ${i} must be accepted`).toBe(true);
      }
    }
  });
});

const validEvidenceResult = () => ({
  id: "packet-001",
  role: "contract-reviewer",
  kind: "evidence",
  conclusions: ["The scheduler owns bounded admission."],
  citations: [{ path: "src/scheduler.ts", lines: "1-20" }],
  constraints: ["Keep state in memory."],
  dependencies: [],
  risks: [],
  blockingQuestions: [],
  hints: {
    writeSet: ["src/scheduler.ts"],
    verification: "bun run check",
    agentsImpact: "none",
  },
});

const validDesignPacketResult = () => ({
  id: "packet-001",
  role: "design-explorer",
  kind: "evidence",
  packet_id: "packet-001",
  module_name: "package-manifest",
  scope: ["package.json"],
  files_read: ["package.json"],
  evidence: [
    {
      claim: "The package has one standalone manifest.",
      path: "package.json",
      line_start: 1,
      line_end: 3,
    },
  ],
  existing_structures: ["package manifest"],
  existing_conventions: ["ES module package"],
  constraints_discovered: ["read-only exploration"],
  open_questions: [],
  dependencies: [],
  write_set_hints: [],
  validation_hints: ["inspect cited lines"],
  agents_impact_hints: ["none"],
  risks: [],
  success_criteria_hints: ["all claims have exact line citations"],
});

describe("strict evidence result schema", () => {
  it("accepts the Design packet shape required by the bundled prompt", () => {
    if (!contracts) return notReady("contracts");
    expect(contracts.validateEvidenceResult(validDesignPacketResult()).ok).toBe(
      true,
    );
  });

  it.each([
    ["mismatched packet identity", { packet_id: "another-packet" }],
    [
      "escaping evidence path",
      {
        evidence: [
          {
            claim: "escape",
            path: "../package.json",
            line_start: 1,
            line_end: 1,
          },
        ],
      },
    ],
    [
      "reversed evidence lines",
      {
        evidence: [
          {
            claim: "reversed",
            path: "package.json",
            line_start: 3,
            line_end: 2,
          },
        ],
      },
    ],
    ["extra control field", { nextStep: "continue" }],
  ])("rejects Design packets with %s", (_name, override) => {
    if (!contracts) return notReady("contracts");
    expect(
      contracts.validateEvidenceResult({
        ...validDesignPacketResult(),
        ...override,
      }).ok,
    ).toBe(false);
  });

  it("[SLICE-5:pi-tool-error] validates a control-free evidence result", () => {
    if (!contracts) return notReady("contracts");
    expect(contracts.validateEvidenceResult(validEvidenceResult()).ok).toBe(
      true,
    );
  });

  it.each(["nextStep", "returnToDesign"])(
    "[SLICE-5:pi-tool-error] rejects %s as an extra evidence control field",
    (field) => {
      if (!contracts) return notReady("contracts");
      expect(
        contracts.validateEvidenceResult({
          ...validEvidenceResult(),
          [field]: "return-to-design",
        }).ok,
      ).toBe(false);
    },
  );

  it("rejects incomplete or malformed evidence fields", () => {
    if (!contracts) return notReady("contracts");
    const valid = validEvidenceResult();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["missing constraints", { constraints: undefined }],
      ["missing dependencies", { dependencies: undefined }],
      ["missing risks", { risks: undefined }],
      ["missing hints", { hints: undefined }],
      ["wrong conclusions", { conclusions: [1] }],
      ["wrong constraints", { constraints: "none" }],
      ["wrong dependencies", { dependencies: [false] }],
      ["wrong risks", { risks: [null] }],
      ["wrong blocking questions", { blockingQuestions: [1] }],
      ["wrong citations", { citations: [{ path: 1, lines: "1" }] }],
      [
        "extra citation control",
        {
          citations: [
            { path: "src/scheduler.ts", lines: "1", nextStep: "design" },
          ],
        },
      ],
      ["escaping citation", { citations: [{ path: "../x", lines: "1" }] }],
      ["wrong hint write set", { hints: { ...valid.hints, writeSet: [1] } }],
      [
        "wrong hint verification",
        { hints: { ...valid.hints, verification: 1 } },
      ],
      ["wrong hint impact", { hints: { ...valid.hints, agentsImpact: "all" } }],
      [
        "extra hint control",
        { hints: { ...valid.hints, nextStep: "return-to-design" } },
      ],
    ];
    for (const [label, overrides] of cases) {
      expect(
        contracts.validateEvidenceResult({ ...valid, ...overrides }).ok,
        `${label} must be rejected`,
      ).toBe(false);
    }
  });
});

const validDiffResult = () => ({
  id: "packet-001",
  role: "implementation-worker",
  kind: "diff",
  taskId: "P-004-A",
  phase: "green",
  summary: "Implement the scheduler contract",
  diff: "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n",
  expectedVerification: "bun run check",
  risks: ["risk"],
  contractCompliant: true,
});

describe("strict diff result fixture precheck", () => {
  it("[SLICE-5:pi-tool-error] validates a control-free diff result", () => {
    if (!contracts) return notReady("contracts");
    const result = contracts.validateDiffResult(validDiffResult());
    expect(result.ok).toBe(true);
  });
});

describe("strict diff result schema", () => {
  it("[SLICE-5:pi-tool-error] rejects nextStep as an extra control field", () => {
    if (!contracts) return notReady("contracts");
    const result = contracts.validateDiffResult({
      ...validDiffResult(),
      nextStep: "return-to-design",
    });
    expect(result.ok).toBe(false);
  });

  it("[SLICE-5:pi-tool-error] omits Implement recovery exports", () => {
    if (!contracts) return notReady("contracts");
    for (const field of [
      "RECOVERY_CODES",
      "RECOVERY_FAILURE_CLASSES",
      "RECOVERY_REASON_CODES",
    ]) {
      expect(contracts).not.toHaveProperty(field);
    }
  });

  it("strict diff result schema and identity shape", () => {
    if (!contracts) return notReady("contracts");
    const mutate = (
      overrides: Record<string, unknown>,
    ): Record<string, unknown> => ({
      ...validDiffResult(),
      ...overrides,
    });
    const cases: [string, Record<string, unknown>][] = [
      ["missing expectedVerification", { expectedVerification: undefined }],
      ["missing risks", { risks: undefined }],
      ["missing task", { taskId: undefined }],
      ["missing phase", { phase: undefined }],
      ["wrong-typed phase", { phase: 7 }],
      ["missing summary", { summary: undefined }],
      ["missing diff", { diff: undefined }],
      ["missing compliance", { contractCompliant: undefined }],
      ["wrong-typed expectedVerification", { expectedVerification: 7 }],
      ["wrong-typed risks", { risks: "not an array" }],
      ["wrong-typed summary", { summary: 7 }],
      ["wrong-typed diff", { diff: 7 }],
      ["wrong-typed compliance", { contractCompliant: "yes" }],
      ["invalid phase", { phase: "blue" }],
      ["incomplete identity shape", { id: "" }],
    ];
    for (const [label, overrides] of cases) {
      const result = contracts.validateDiffResult(mutate(overrides));
      expect(result.ok, `${label} must be rejected`).toBe(false);
    }
  });
});
