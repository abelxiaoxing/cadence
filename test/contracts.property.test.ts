import { describe, expect, it } from "vitest";

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
    runId: "design-run-001",
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

const REQUIRED_FIELDS = [
  "stage",
  "role",
  "runId",
  "id",
  "phase",
  "objective",
  "roots",
  "output",
];

describe("strict packet envelope contracts", () => {
  it("[SLICE-1:boundary-once] keeps Design and Diagnose run envelopes valid", () => {
    if (!contracts) return notReady("contracts");
    expect(contracts.validatePacketEnvelope(validEnvelope()).ok).toBe(true);
    const diagnose = validEnvelope({
      stage: "abel-diagnose",
      role: "diagnosis-worker",
      id: "diagnose-001",
      phase: "red",
      objective: "Diagnose the bounded regression",
      output: "diff",
    }) as Record<string, unknown>;
    delete diagnose.runId;
    expect(contracts.validatePacketEnvelope(diagnose).ok).toBe(true);
  });

  it("accepts a valid evidence envelope", () => {
    if (!contracts) return notReady("contracts");
    const result = contracts.validatePacketEnvelope(validEnvelope());
    expect(result.ok).toBe(true);
  });

  it("rejects an empty envelope", () => {
    if (!contracts) return notReady("contracts");
    expect(contracts.validatePacketEnvelope({}).ok).toBe(false);
    expect(contracts.validatePacketEnvelope(null).ok).toBe(false);
    expect(contracts.validatePacketEnvelope(undefined).ok).toBe(false);
  });

  it("rejects envelopes missing any required field", () => {
    if (!contracts) return notReady("contracts");
    for (const field of REQUIRED_FIELDS) {
      const env = validEnvelope() as Record<string, unknown>;
      delete env[field];
      const result = contracts.validatePacketEnvelope(env);
      expect(result.ok, `missing ${field} must be rejected`).toBe(false);
      expect((result as { ok: false; reason: string }).reason).toMatch(
        /missing|required/i,
      );
    }
  });

  it("rejects unknown stages and roles", () => {
    if (!contracts) return notReady("contracts");
    expect(
      contracts.validatePacketEnvelope(validEnvelope({ stage: "abel-init" }))
        .ok,
    ).toBe(false);
    expect(
      contracts.validatePacketEnvelope(validEnvelope({ stage: "unknown" })).ok,
    ).toBe(false);
    expect(
      contracts.validatePacketEnvelope(validEnvelope({ role: "random-agent" }))
        .ok,
    ).toBe(false);
  });

  it("rejects envelopes over the 64 KiB serialized limit", () => {
    if (!contracts) return notReady("contracts");
    const big = validEnvelope({
      context: {
        agents: "## AGENTS excerpt",
        contract: "x".repeat(70 * 1024),
      },
    });
    const result = contracts.validatePacketEnvelope(big);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(
      /64|limit|kib|large/i,
    );
  });

  it("rejects path bounds that escape or are absolute", () => {
    if (!contracts) return notReady("contracts");
    for (const root of ["/etc", "..", "../src", "src/../../etc"]) {
      const result = contracts.validatePacketEnvelope(
        validEnvelope({ roots: [root] }),
      );
      expect(result.ok, `root ${root} must be rejected`).toBe(false);
    }
    const env = validEnvelope() as Record<string, unknown>;
    (env.declared as { write: string[] }).write = ["/tmp/out.patch"];
    expect(contracts.validatePacketEnvelope(env).ok).toBe(false);
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
        contracts.validatePacketEnvelope(design).ok,
        `Design declaration ${path} must fail closed`,
      ).toBe(false);
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
      const result = contracts.validatePacketEnvelope(env);
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
  role: "diagnosis-worker",
  kind: "evidence",
  conclusions: ["The packet runtime owns bounded admission."],
  citations: [{ path: "src/packet-runtime.ts", lines: "1-20" }],
  constraints: ["Keep state in memory."],
  dependencies: [],
  risks: [],
  blockingQuestions: [],
  hints: {
    writeSet: ["src/packet-runtime.ts"],
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
            { path: "src/packet-runtime.ts", lines: "1", nextStep: "design" },
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

describe("workflow control command schema", () => {
  it("reserves command control for Implement and rejects Design envelopes", () => {
    if (!contracts) return notReady("contracts");
    expect(
      contracts.validateControlCommand({
        command: "start",
        stage: "abel-implement",
        change: "clean-control-surface",
        operationId: "implement-start-001",
      }),
    ).toMatchObject({ ok: true });
    expect(
      contracts.validateControlCommand({
        command: "start",
        stage: "abel-design",
        requirement: "raw private requirement",
        operationId: "design-start-001",
      }),
    ).toMatchObject({ ok: false, code: "invalid-control-command" });
  });

  it("rejects caller-supplied versions and undeclared fields", () => {
    if (!contracts) return notReady("contracts");
    expect(
      contracts.validateControlCommand({
        version: 2,
        command: "start",
        stage: "abel-implement",
        change: "durable-control-plane",
        operationId: "start-with-version",
      }),
    ).toMatchObject({ ok: false, code: "invalid-control-command" });
    expect(
      contracts.validateControlCommand({
        command: "resume",
        stage: "abel-implement",
        change: "durable-control-plane",
        operationId: "resume-001",
        graphHash: "undeclared",
      }),
    ).toMatchObject({ ok: false, code: "invalid-control-command" });
  });
});
