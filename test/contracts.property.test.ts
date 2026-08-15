import { describe, expect, it } from "vitest";

let contracts = null;
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

  it("extracts write paths from ordinary unified diff headers", () => {
    if (!contracts) return notReady("contracts");
    const diff = [
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,3 +1,4 @@",
      " old",
      "+new",
      "",
      "--- a/test/x.test.ts",
      "+++ b/test/x.test.ts",
      "@@ -5 +5 @@",
      " a",
      " b",
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

const validDiffResult = () => ({
  id: "packet-001",
  role: "implementation-worker",
  kind: "diff",
  taskId: "P-004-A",
  phase: "green",
  summary: "Implement the scheduler contract",
  diff: "--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,3 @@\n a\n-b\n+c\n",
  expectedVerification: "bun run check",
  risks: ["risk"],
  nextStep: "review the accepted Green",
  contractCompliant: true,
});

describe("strict diff result fixture precheck", () => {
  it("validates the approved control fixture", () => {
    if (!contracts) return notReady("contracts");
    const result = contracts.validateDiffResult(validDiffResult());
    expect(result.ok).toBe(true);
  });
});

describe("strict diff result schema", () => {
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
      ["missing nextStep", { nextStep: undefined }],
      ["missing task", { taskId: undefined }],
      ["missing phase", { phase: undefined }],
      ["wrong-typed phase", { phase: 7 }],
      ["missing summary", { summary: undefined }],
      ["missing diff", { diff: undefined }],
      ["missing compliance", { contractCompliant: undefined }],
      ["wrong-typed expectedVerification", { expectedVerification: 7 }],
      ["wrong-typed risks", { risks: "not an array" }],
      ["wrong-typed nextStep", { nextStep: 7 }],
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
