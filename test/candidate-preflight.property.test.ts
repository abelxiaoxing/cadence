import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BaselineEntry,
  type CandidatePreflightDependencies,
  type CandidatePreflightInput,
  type CandidatePreflightResult,
  preflightCandidate,
  type VerificationContract,
} from "../src/candidate-preflight.ts";
import type { Bound, DirBound, FileBound } from "../src/file-snapshot.ts";
import {
  isCurrent,
  mergeBounds,
  snapshotDirManifests,
  snapshotFiles,
} from "../src/file-snapshot.ts";

function requirePreflight(): typeof preflightCandidate {
  return preflightCandidate;
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const RED_IDENTITY = "[PREFLIGHT:expected-red]";
const BWRAP = "/test-only/bin/bwrap";
const SANDBOX_BUN_TARGET = "/usr/bin/bun";
const SANDBOX_REPORT_TARGET = "/tmp/cadence-verification-report.json";

function resolveBunExecutable(): string {
  const candidates = [
    ...(process.versions.bun ? [process.execPath] : []),
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((entry) => path.join(entry, "bun")),
  ];
  for (const candidate of candidates) {
    try {
      const executable = realpathSync(candidate);
      if (statSync(executable).isFile()) return executable;
    } catch {}
  }
  throw new Error("Bun executable unavailable for sandbox mount test");
}

const MODIFY_DIFF = Buffer.from(
  [
    "--- a/src/value.ts",
    "+++ b/src/value.ts",
    "@@ -1 +1 @@",
    '-export const value = "old";',
    '+export const value = "new";',
    "",
  ].join("\n"),
);
const MALFORMED_SOURCE_DIFF = Buffer.from(
  [
    "--- a/src/value.ts",
    "+++ b/src/value.ts",
    "@@ -1 +1 @@",
    '-export const value = "old";',
    "+export const value = ;",
    "",
  ].join("\n"),
);
const DELETE_DIFF = Buffer.from(
  [
    "--- a/src/deleted.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-remove me",
    "",
  ].join("\n"),
);

const GREEN_OUTPUT = [
  " RUN  v4.1.8 /candidate",
  " ✓ test/candidate.test.ts (2 tests) 2ms",
  " Test Files  1 passed (1)",
  "      Tests  2 passed (2)",
  "",
].join("\n");
const RED_OUTPUT = [
  " FAIL  test/candidate.test.ts > candidate > [PREFLIGHT:expected-red]",
  "AssertionError: [PREFLIGHT:expected-red]",
  " Test Files  1 failed (1)",
  "      Tests  1 failed | 1 passed (2)",
  "",
].join("\n");

interface Fixture {
  root: string;
  snapshot: Bound;
  baseline: BaselineEntry[];
  packageManifest: FileBound;
  lockfile: FileBound;
  dependencyTarget: DirBound;
}

function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`fixture git failed: ${result.stderr}`);
}

function asFile(bound: Bound, name: string): FileBound {
  const entry = bound[name];
  if (entry?.kind !== "file")
    throw new Error(`fixture did not snapshot ${name} as a file`);
  return entry;
}

function asDir(bound: Bound, name: string): DirBound {
  const entry = bound[name];
  if (entry?.kind !== "dir")
    throw new Error(`fixture did not snapshot ${name} as a directory`);
  return entry;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-preflight-host-"));
  roots.push(root);
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "test"));
  mkdirSync(path.join(root, "node_modules"));
  writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "candidate-preflight-fixture",
        private: true,
        scripts: {
          check: "tsc --noEmit",
          "test:target": "vitest run",
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(path.join(root, "bun.lock"), "# fixture lock\n");
  writeFileSync(
    path.join(root, "src/value.ts"),
    'export const value = "old";\n',
  );
  writeFileSync(path.join(root, "src/deleted.ts"), "remove me\n");
  writeFileSync(
    path.join(root, "test/candidate.test.ts"),
    `// ${RED_IDENTITY}\nexport {};\n`,
  );
  writeFileSync(path.join(root, "node_modules/.sentinel"), "immutable\n");

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Cadence Preflight Test"]);
  const baselinePaths = [
    ".gitignore",
    "package.json",
    "bun.lock",
    "src/value.ts",
    "src/deleted.ts",
    "test/candidate.test.ts",
  ];
  git(root, ["add", "--", ...baselinePaths]);
  git(root, ["commit", "-qm", "baseline"]);

  const files = snapshotFiles(root, baselinePaths);
  const dependency = snapshotDirManifests(root, ["node_modules"]);
  const snapshot = mergeBounds(files, dependency);
  const baseline = baselinePaths.map((name): BaselineEntry => {
    const entry = asFile(files, name);
    return {
      path: name,
      kind: "file",
      sha256: entry.sha256,
      bytes: entry.bytes,
      executable: Boolean(statSync(path.join(root, name)).mode & 0o111),
    };
  });
  return {
    root,
    snapshot,
    baseline,
    packageManifest: asFile(files, "package.json"),
    lockfile: asFile(files, "bun.lock"),
    dependencyTarget: asDir(dependency, "node_modules"),
  };
}

function verification(
  classification: VerificationContract["classification"],
): VerificationContract {
  return {
    id: `candidate-preflight-${classification}`,
    argv: ["bun", "run", "test:target", "test/candidate.test.ts"],
    classification,
    ...(classification === "expected-red"
      ? { expectedFailure: RED_IDENTITY }
      : {}),
    minTests: 1,
  };
}

function staticVerification(
  classification: VerificationContract["classification"],
): VerificationContract {
  return {
    id: `candidate-static-${classification}`,
    argv: ["bun", "run", "check"],
    classification,
    ...(classification === "expected-red"
      ? { expectedFailure: "[PREFLIGHT:static-red]" }
      : {}),
    minTests: 1,
  };
}

function inputFor(
  fixture: Fixture,
  options: {
    diff?: Buffer;
    writeSet?: string[];
    snapshot?: Bound;
    verification?: VerificationContract;
    signal?: AbortSignal;
  } = {},
): CandidatePreflightInput {
  return {
    root: fixture.root,
    diff: options.diff ?? MODIFY_DIFF,
    writeSet: options.writeSet ?? ["src/value.ts"],
    snapshot: options.snapshot ?? fixture.snapshot,
    baseline: fixture.baseline,
    verification: options.verification ?? verification("expected-green"),
    packageManifest: fixture.packageManifest,
    lockfile: fixture.lockfile,
    dependencyTarget: fixture.dependencyTarget,
    signal: options.signal,
  };
}

interface CommandOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface SandboxScript {
  check?: CommandOutcome;
  probe?: CommandOutcome;
  target?: CommandOutcome;
  bwrapError?: Error;
  onTarget?: () => void;
}

interface SandboxCall {
  args: string[];
  invocation: string[];
  kind: "check" | "target" | "probe";
}

interface Observation {
  temps: string[];
  removed: string[];
  calls: SandboxCall[];
  deletionObserved: boolean;
}

const ok = (stdout = ""): CommandOutcome => ({
  status: 0,
  stdout,
  stderr: "",
});

function structuredReportFor(outcome: CommandOutcome): Record<string, unknown> {
  const count = Math.max(
    0,
    ...[...outcome.stdout.matchAll(/(\d+)\s+(?:tests?|passed|failed)/giu)].map(
      (match) => Number(match[1]),
    ),
    ...[...outcome.stdout.matchAll(/\((\d+)\)/gu)].map((match) =>
      Number(match[1]),
    ),
  );
  const failure = /FAIL[^\n]* > ([^\n]+)/u.exec(outcome.stdout)?.[1];
  const assertion = /AssertionError: ([^\n]+)/u.exec(outcome.stdout)?.[1];
  const failed = outcome.status !== 0 && failure ? 1 : 0;
  return {
    numTotalTests: count,
    numFailedTests: failed,
    success: outcome.status === 0 && count > 0,
    testResults: [
      {
        message: "",
        assertionResults: failure
          ? [
              {
                status: "failed",
                fullName: failure,
                title: failure,
                failureMessages: assertion ? [assertion] : [],
              },
            ]
          : [],
      },
    ],
  };
}

function invocationFrom(args: string[]): string[] {
  const separator = args.lastIndexOf("--");
  if (separator >= 0) return args.slice(separator + 1);
  const bun = args.findIndex((arg) => arg === "bun" || arg.endsWith("/bun"));
  return bun >= 0 ? args.slice(bun) : [];
}

function checkoutIn(temps: string[]): string | null {
  for (const temp of temps) {
    const candidates = [temp];
    try {
      for (const entry of readdirSync(temp, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(path.join(temp, entry.name));
      }
    } catch {
      continue;
    }
    for (const candidate of candidates) {
      if (existsSync(path.join(candidate, "package.json"))) return candidate;
    }
  }
  return null;
}

function spawnResult(
  outcome: CommandOutcome,
  options: Record<string, unknown>,
): unknown {
  const wantsText =
    typeof options.encoding === "string" && options.encoding !== "buffer";
  const stdout = wantsText ? outcome.stdout : Buffer.from(outcome.stdout);
  const stderr = wantsText ? outcome.stderr : Buffer.from(outcome.stderr);
  return {
    pid: 4242,
    output: [null, stdout, stderr],
    stdout,
    stderr,
    status: outcome.status,
    signal: null,
    error: outcome.error,
  };
}

function makeDependencies(script: SandboxScript = {}): {
  dependencies: CandidatePreflightDependencies;
  observed: Observation;
} {
  const observed: Observation = {
    temps: [],
    removed: [],
    calls: [],
    deletionObserved: false,
  };
  const mkdtemp = ((prefix: string) => {
    const created = mkdtempSync(prefix);
    observed.temps.push(created);
    roots.push(created);
    return created;
  }) as unknown as typeof mkdtempSync;
  const remove = ((
    target: Parameters<typeof rmSync>[0],
    options?: Parameters<typeof rmSync>[1],
  ) => {
    observed.removed.push(String(target));
    rmSync(target, options);
  }) as unknown as typeof rmSync;
  const realpath = ((target: Parameters<typeof realpathSync>[0]) => {
    if (String(target) === BWRAP) return BWRAP;
    return realpathSync(target);
  }) as unknown as typeof realpathSync;

  const spawn = ((
    command: string,
    argsOrOptions?: string[] | Record<string, unknown>,
    maybeOptions?: Record<string, unknown>,
  ) => {
    const args = Array.isArray(argsOrOptions) ? [...argsOrOptions] : [];
    const options =
      (Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions) ?? {};
    if (command !== BWRAP) return spawnSync(command, args, options as never);

    const invocation = invocationFrom(args);
    const kind: SandboxCall["kind"] =
      invocation[0]?.endsWith("bun") && invocation[1] === "--version"
        ? "probe"
        : invocation[1] === "run" && invocation[2] === "check"
          ? "check"
          : invocation.length > 0
            ? "target"
            : "probe";
    observed.calls.push({ args, invocation, kind });
    const checkout = checkoutIn(observed.temps);
    if (checkout)
      observed.deletionObserved ||= !existsSync(
        path.join(checkout, "src/deleted.ts"),
      );
    if (script.bwrapError)
      return spawnResult(
        {
          status: null,
          stdout: "",
          stderr: script.bwrapError.message,
          error: script.bwrapError,
        },
        options,
      );
    if (kind === "target") script.onTarget?.();
    const outcome =
      kind === "probe"
        ? (script.probe ?? ok("1.3.14\n"))
        : kind === "check"
          ? (script.check ?? ok("check passed\n"))
          : kind === "target"
            ? (script.target ?? ok(GREEN_OUTPUT))
            : ok("bubblewrap 0.test\n");
    if (kind === "target") {
      const destination = args.indexOf(SANDBOX_REPORT_TARGET);
      if (destination >= 2 && args[destination - 2] === "--bind") {
        writeFileSync(
          args[destination - 1],
          JSON.stringify(structuredReportFor(outcome)),
        );
      }
    }
    return spawnResult(outcome, options);
  }) as unknown as typeof spawnSync;

  return {
    dependencies: {
      mkdtemp,
      remove,
      spawn,
      realpath,
      bwrapPath: BWRAP,
    },
    observed,
  };
}

function expectCleanup(
  result: CandidatePreflightResult,
  observed: Observation,
): void {
  expect(result.checkoutRemoved).toBe(true);
  expect(observed.temps.length).toBeGreaterThan(0);
  expect(observed.removed.length).toBeGreaterThan(0);
  for (const temp of observed.temps) expect(existsSync(temp)).toBe(false);
}

function hasMount(
  args: string[],
  flag: string,
  source: string,
  destination: (value: string) => boolean,
): boolean {
  for (let index = 0; index + 2 < args.length; index++) {
    if (
      args[index] === flag &&
      args[index + 1] === source &&
      destination(args[index + 2])
    )
      return true;
  }
  return false;
}

describe("isolated candidate preflight", () => {
  it("admits an expected Red only for the bound failure identity", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const input = inputFor(fixture, {
      verification: verification("expected-red"),
    });
    const harness = makeDependencies({
      target: { status: 1, stdout: RED_OUTPUT, stderr: "" },
    });

    const result = await preflight(input, harness.dependencies);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      classification: "expected-red",
      targets: ["src/value.ts"],
      commandId: input.verification.id,
      exitCode: 1,
      identityMatch: true,
      checkoutRemoved: true,
    });
    expect(result.testCount).toBeGreaterThanOrEqual(1);
  });

  it("returns a passing expected Red contract to Design", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const input = inputFor(fixture, {
      verification: verification("expected-red"),
    });
    const harness = makeDependencies({ target: ok(GREEN_OUTPUT) });

    const result = await preflight(input, harness.dependencies);

    expect(result).toMatchObject({
      ok: false,
      class: "design",
      code: "red-contract-invalid",
      commandId: input.verification.id,
      exitCode: 0,
      checkoutRemoved: true,
    });
  });

  it("admits an expected Green control with discovered tests", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const input = inputFor(fixture);
    const harness = makeDependencies();

    const result = await preflight(input, harness.dependencies);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      classification: "expected-green",
      targets: ["src/value.ts"],
      commandId: input.verification.id,
      exitCode: 0,
      identityMatch: true,
      checkoutRemoved: true,
    });
    expect(result.testCount).toBeGreaterThanOrEqual(1);
  });

  it("[PREFLIGHT:write-set-subset] admits targets within a larger declared write set", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const input = inputFor(fixture, {
      writeSet: ["src/value.ts", "src/deleted.ts"],
    });
    const harness = makeDependencies();

    const result = await preflight(input, harness.dependencies);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targets).toEqual(["src/value.ts"]);
    expect(result.checkoutRemoved).toBe(true);
  });

  it.each([
    [
      "expected-red",
      {
        status: 1,
        stdout: "src/value.ts(1,1): error TS2322: [PREFLIGHT:static-red]\n",
        stderr: "",
      },
    ],
    ["expected-green", ok("check passed\n")],
    ["expected-refactor", ok("check passed\n")],
  ] as const)(
    "normalizes a static %s contract without test counts",
    async (classification, check) => {
      const preflight = requirePreflight();
      const fixture = makeFixture();
      const input = inputFor(fixture, {
        verification: staticVerification(classification),
      });
      const harness = makeDependencies({ check });

      const result = await preflight(input, harness.dependencies);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result).toMatchObject({
        classification,
        commandId: input.verification.id,
        exitCode: check.status,
        testCount: 0,
        identityMatch: true,
      });
      expect(
        harness.observed.calls.filter(
          (call) => call.invocation.join(" ") === "bun run check",
        ),
      ).toHaveLength(1);
    },
  );

  it("rejects malformed, unloadable, no-test, and wrong-identity artifacts", async () => {
    const preflight = requirePreflight();
    const cases: Array<{
      label: string;
      build: (fixture: Fixture) => {
        input: CandidatePreflightInput;
        script?: SandboxScript;
      };
      expected?: Partial<Extract<CandidatePreflightResult, { ok: false }>>;
    }> = [
      {
        label: "malformed source",
        build: (fixture) => ({
          input: inputFor(fixture, {
            diff: MALFORMED_SOURCE_DIFF,
          }),
          script: {
            check: {
              status: 1,
              stdout:
                "src/value.ts(1,22): error TS1109: Expression expected.\n",
              stderr: "",
            },
          },
        }),
      },
      {
        label: "loadability",
        build: (fixture) => ({
          input: inputFor(fixture),
          script: {
            target: {
              status: 1,
              stdout:
                " FAIL test/candidate.test.ts\nError: Failed to load url ./missing-module\nTests  no tests\n",
              stderr: "",
            },
          },
        }),
      },
      {
        label: "no tests",
        build: (fixture) => ({
          input: inputFor(fixture),
          script: {
            target: {
              status: 0,
              stdout:
                "No test files found, exiting with code 0\nTests  0 passed (0)\n",
              stderr: "",
            },
          },
        }),
        expected: { testCount: 0 },
      },
      {
        label: "wrong expected-Red identity",
        build: (fixture) => ({
          input: inputFor(fixture, {
            verification: verification("expected-red"),
          }),
          script: {
            target: {
              status: 1,
              stdout: `${RED_IDENTITY}\n FAIL test/candidate.test.ts > [PREFLIGHT:different]\nAssertionError: [PREFLIGHT:different]\nTests  1 failed (1)\n`,
              stderr: "",
            },
          },
        }),
        expected: { identityMatch: false },
      },
      {
        label: "expected-Red runs no tests",
        build: (fixture) => ({
          input: inputFor(fixture, {
            verification: verification("expected-red"),
          }),
          script: {
            target: {
              status: 0,
              stdout:
                "No test files found, exiting with code 0\nTests  0 passed (0)\n",
              stderr: "",
            },
          },
        }),
        expected: { testCount: 0 },
      },
    ];

    for (const scenario of cases) {
      const fixture = makeFixture();
      const built = scenario.build(fixture);
      const harness = makeDependencies(built.script);
      const result = await preflight(built.input, harness.dependencies);
      expect(result.ok, scenario.label).toBe(false);
      if (result.ok) continue;
      expect(result, scenario.label).toMatchObject({
        class: "artifact",
        checkoutRemoved: true,
        ...(scenario.expected ?? {}),
      });
    }
  });

  it("classifies a real merged snapshot drift as stale", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const input = inputFor(fixture);
    writeFileSync(
      path.join(fixture.root, "src/value.ts"),
      'export const value = "sibling";\n',
    );
    const harness = makeDependencies();

    const result = await preflight(input, harness.dependencies);

    expect(result).toMatchObject({
      ok: false,
      class: "stale",
      checkoutRemoved: true,
    });
    expect(harness.observed.calls).toHaveLength(0);
  });

  it("reconstructs and applies a tracked deletion in the checkout", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const input = inputFor(fixture, {
      diff: DELETE_DIFF,
      writeSet: ["src/deleted.ts"],
    });
    const harness = makeDependencies();

    const result = await preflight(input, harness.dependencies);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targets).toEqual(["src/deleted.ts"]);
    expect(harness.observed.deletionObserved).toBe(true);
  });

  it("normalizes reconstructed executable files to regular executable mode", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    chmodSync(path.join(fixture.root, "src/value.ts"), 0o744);
    const baseline = fixture.baseline.find(
      (entry) => entry.path === "src/value.ts",
    );
    if (!baseline) expect.fail("fixture baseline is unavailable");
    baseline.executable = true;
    let candidateMode: number | undefined;
    const harness = makeDependencies({
      onTarget: () => {
        const checkout = checkoutIn(harness.observed.temps);
        if (checkout) {
          candidateMode = statSync(path.join(checkout, "src/value.ts")).mode;
        }
      },
    });

    const result = await preflight(inputFor(fixture), harness.dependencies);

    expect(result.ok).toBe(true);
    expect((candidateMode ?? 0) & 0o777).toBe(0o755);
  });

  it("removes the private checkout after success", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const harness = makeDependencies();

    const result = await preflight(inputFor(fixture), harness.dependencies);

    expect(result.ok).toBe(true);
    expectCleanup(result, harness.observed);
  });

  it("removes the private checkout after artifact failure", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const harness = makeDependencies({
      target: {
        status: 1,
        stdout:
          " FAIL test/candidate.test.ts > unexpected regression\nTests  1 failed (1)\n",
        stderr: "",
      },
    });

    const result = await preflight(inputFor(fixture), harness.dependencies);

    expect(result).toMatchObject({ ok: false, class: "artifact" });
    expectCleanup(result, harness.observed);
  });

  it("returns cleanup exceptions as environment after a verified retry", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const harness = makeDependencies();
    const remove = harness.dependencies.remove;
    let attempts = 0;
    harness.dependencies.remove = ((
      target: Parameters<typeof rmSync>[0],
      options?: Parameters<typeof rmSync>[1],
    ) => {
      attempts++;
      if (attempts === 1) {
        throw Object.assign(new Error("checkout cleanup busy"), {
          code: "EBUSY",
        });
      }
      remove(target, options);
    }) as typeof rmSync;

    const result = await preflight(inputFor(fixture), harness.dependencies);

    expect(result).toMatchObject({
      ok: false,
      class: "environment",
      code: "checkout-cleanup-failed",
      checkoutRemoved: true,
    });
    expect(attempts).toBe(2);
    for (const temp of harness.observed.temps)
      expect(existsSync(temp)).toBe(false);
  });

  it("reports an unremoved checkout without rejecting the preflight promise", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const harness = makeDependencies();
    let attempts = 0;
    harness.dependencies.remove = (() => {
      attempts++;
      throw Object.assign(new Error("checkout cleanup denied"), {
        code: "EACCES",
      });
    }) as typeof rmSync;

    const result = await preflight(inputFor(fixture), harness.dependencies);

    expect(result).toMatchObject({
      ok: false,
      class: "environment",
      code: "checkout-cleanup-failed",
      checkoutRemoved: false,
    });
    expect(attempts).toBe(2);
    for (const temp of harness.observed.temps)
      expect(existsSync(temp)).toBe(true);
  });

  it("removes the private checkout and reports cancellation", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const controller = new AbortController();
    const harness = makeDependencies({
      onTarget: () => controller.abort(),
    });

    const result = await preflight(
      inputFor(fixture, { signal: controller.signal }),
      harness.dependencies,
    );

    expect(result).toMatchObject({
      ok: false,
      class: "cancelled",
      checkoutRemoved: true,
    });
    expectCleanup(result, harness.observed);
  });

  it("keeps host and dependency inputs immutable behind sandbox mounts", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const input = inputFor(fixture);
    const packageBefore = readFileSync(path.join(fixture.root, "package.json"));
    const dependencyBefore = readFileSync(
      path.join(fixture.root, "node_modules/.sentinel"),
    );
    const harness = makeDependencies();

    const result = await preflight(input, harness.dependencies);

    expect(result.ok).toBe(true);
    expect(isCurrent(fixture.root, input.snapshot)).toBe(true);
    expect(readFileSync(path.join(fixture.root, "package.json"))).toEqual(
      packageBefore,
    );
    expect(
      readFileSync(path.join(fixture.root, "node_modules/.sentinel")),
    ).toEqual(dependencyBefore);

    const check = harness.observed.calls.find((call) => call.kind === "check");
    const target = harness.observed.calls.find(
      (call) => call.kind === "target",
    );
    expect(check?.invocation).toEqual(["bun", "run", "check"]);
    expect(target?.invocation).toEqual([
      ...input.verification.argv,
      "--reporter=json",
      `--outputFile=${SANDBOX_REPORT_TARGET}`,
    ]);
    expect(
      target?.args.some(
        (arg, index, args) =>
          arg === "--bind" &&
          args[index + 2] === SANDBOX_REPORT_TARGET &&
          args[index + 1]?.endsWith("verification-report.json"),
      ),
    ).toBe(true);
    const bunExecutable = resolveBunExecutable();
    const home = process.env.HOME ? realpathSync(process.env.HOME) : undefined;
    for (const call of [check, target]) {
      expect(call).toBeDefined();
      const sandbox = call?.args ?? [];
      expect(
        hasMount(
          sandbox,
          "--ro-bind",
          bunExecutable,
          (destination) => destination === SANDBOX_BUN_TARGET,
        ),
      ).toBe(true);
      if (!home) continue;
      for (let index = 0; index + 1 < sandbox.length; index++) {
        if (sandbox[index] !== "--ro-bind") continue;
        const source = sandbox[index + 1];
        expect(
          source === bunExecutable || !source.startsWith(`${home}${path.sep}`),
          `sandbox mounted user prefix instead of Bun executable: ${source}`,
        ).toBe(true);
      }
    }
    const args = target?.args ?? [];
    const pathIndex = args.findIndex(
      (arg, index) => arg === "PATH" && args[index - 1] === "--setenv",
    );
    expect(args[pathIndex + 1]).toBe("/usr/bin:/usr/local/bin:/bin");
    expect(args).toContain("--unshare-net");
    expect(args).toContain("--unshare-pid");
    expect(
      args.some(
        (arg, index) => arg === "--tmpfs" && args[index + 1] === "/tmp",
      ),
    ).toBe(true);
    const dependencyPath = realpathSync(
      path.join(fixture.root, "node_modules"),
    );
    expect(
      hasMount(args, "--ro-bind", dependencyPath, (destination) =>
        destination.endsWith("/node_modules"),
      ),
    ).toBe(true);
    for (let index = 0; index + 1 < args.length; index++) {
      if (args[index] !== "--bind" && args[index] !== "--bind-try") continue;
      const source = args[index + 1];
      expect(
        source === fixture.root ||
          source.startsWith(`${fixture.root}${path.sep}`),
        `host path was writable in sandbox: ${source}`,
      ).toBe(false);
    }
  });

  it("classifies a request snapshot changed before baseline capture as stale", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    writeFileSync(
      path.join(fixture.root, "src/value.ts"),
      'export const value = "changed while worker ran";\n',
    );
    const current = asFile(
      snapshotFiles(fixture.root, ["src/value.ts"]),
      "src/value.ts",
    );
    const baseline = fixture.baseline.map((entry) =>
      entry.path === "src/value.ts"
        ? {
            path: entry.path,
            kind: "file" as const,
            sha256: current.sha256,
            bytes: current.bytes,
            executable: false,
          }
        : entry,
    );
    const harness = makeDependencies();

    const result = await preflight(
      { ...inputFor(fixture), baseline },
      harness.dependencies,
    );

    expect(result).toMatchObject({
      ok: false,
      class: "stale",
      code: "stale-snapshot",
      checkoutRemoved: true,
    });
    expect(harness.observed.temps).toHaveLength(0);
  });

  it("settles cancellation while an asynchronous command is running", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const harness = makeDependencies();
    const controller = new AbortController();
    let commandStarted = false;
    let commandTimeout: unknown;
    const originalSpawn = harness.dependencies.spawn;
    harness.dependencies.spawn = ((
      command: string,
      args: string[],
      options: Record<string, unknown>,
    ) => {
      if (commandStarted) return originalSpawn(command, args, options as never);
      commandStarted = true;
      commandTimeout = options.timeout;
      const signal = options.signal as AbortSignal;
      return new Promise((resolve) => {
        const cancelled = () =>
          resolve(
            spawnResult(
              {
                status: null,
                stdout: "",
                stderr: "aborted",
                error: Object.assign(new Error("aborted"), {
                  name: "AbortError",
                }),
              },
              options,
            ),
          );
        if (signal.aborted) cancelled();
        else signal.addEventListener("abort", cancelled, { once: true });
      });
    }) as unknown as typeof spawnSync;

    const pending = preflight(
      inputFor(fixture, { signal: controller.signal }),
      harness.dependencies,
    );
    expect(commandStarted).toBe(true);
    expect(commandTimeout).toEqual(expect.any(Number));
    expect(commandTimeout as number).toBeGreaterThan(0);
    controller.abort(new Error("cancel running preflight"));
    const result = await pending;

    expect(result).toMatchObject({ ok: false, class: "cancelled" });
    expectCleanup(result, harness.observed);
  });

  it("classifies a Bubblewrap launch failure as environment", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const missing = Object.assign(new Error("spawn bwrap ENOENT"), {
      code: "ENOENT",
    });
    const harness = makeDependencies({ bwrapError: missing });

    const result = await preflight(inputFor(fixture), harness.dependencies);

    expect(result).toMatchObject({
      ok: false,
      class: "environment",
      checkoutRemoved: true,
    });
    expectCleanup(result, harness.observed);
  });

  it("classifies a Bun sandbox probe failure as environment", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const harness = makeDependencies({
      probe: { status: 127, stdout: "", stderr: "bun unavailable\n" },
    });

    const result = await preflight(inputFor(fixture), harness.dependencies);

    expect(result).toMatchObject({
      ok: false,
      class: "environment",
      code: "sandbox-runtime-unavailable",
      exitCode: 127,
      checkoutRemoved: true,
    });
  });

  it("rejects a top-level dependency symlink that resolves outside the workspace", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const outside = mkdtempSync(
      path.join(tmpdir(), "cadence-preflight-external-dependency-"),
    );
    roots.push(outside);
    writeFileSync(path.join(outside, "private.txt"), "host private data\n");
    rmSync(path.join(fixture.root, "node_modules"), {
      recursive: true,
      force: true,
    });
    symlinkSync(outside, path.join(fixture.root, "node_modules"), "dir");
    const dependency = snapshotDirManifests(fixture.root, ["node_modules"]);
    const input = inputFor(fixture, {
      snapshot: mergeBounds(fixture.snapshot, dependency),
    });
    input.dependencyTarget = asDir(dependency, "node_modules");
    const harness = makeDependencies();

    const result = await preflight(input, harness.dependencies);

    expect(result).toMatchObject({
      ok: false,
      class: "environment",
      code: "dependency-path-unsafe",
      checkoutRemoved: true,
    });
    expect(harness.observed.temps).toHaveLength(0);
  });

  it("keeps a candidate target exit 127 classified as artifact", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const harness = makeDependencies({
      target: {
        status: 127,
        stdout: "Tests  1 failed (1)\n",
        stderr: "approved script command not found\n",
      },
    });

    const result = await preflight(inputFor(fixture), harness.dependencies);

    expect(result).toMatchObject({
      ok: false,
      class: "artifact",
      code: "verification-rejected",
      exitCode: 127,
      checkoutRemoved: true,
    });
  });

  it("keeps a candidate check exit 127 classified as artifact", async () => {
    const preflight = requirePreflight();
    const fixture = makeFixture();
    const harness = makeDependencies({
      check: {
        status: 127,
        stdout: "",
        stderr: "approved check script command not found\n",
      },
    });

    const result = await preflight(inputFor(fixture), harness.dependencies);

    expect(result).toMatchObject({
      ok: false,
      class: "artifact",
      code: "candidate-check-failed",
      exitCode: 127,
      checkoutRemoved: true,
    });
  });
});
