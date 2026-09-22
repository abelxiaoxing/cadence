import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compileImplementPlan } from "../src/delivery-compiler.ts";
import { executionProfile } from "../src/execution-profile.ts";
import { BubblewrapIsolationBackend } from "../src/isolation-backend.ts";
import { inspectRuns, storageUsage } from "../src/operator-tools.ts";
import { executePackageVerification } from "../src/package-verification.ts";
import { expandSingleTaskDraft } from "../src/single-task-draft.ts";
import { requestBounds } from "../src/transport-budget.ts";
import { VerificationFeedback } from "../src/verification-diagnostics.ts";
import { prepareVerificationEnvironment } from "../src/verification-environment.ts";
import { coalesceVerificationScans } from "../src/verification-scan.ts";

const roots: string[] = [];
const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-ux-fix-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  });
});

it("separates readable diagnostics from failure identities and avoids timestamp drift / stderr loss", async () => {
  const root = fixture();
  writeFileSync(path.join(root, "failure.mjs"), "process.exitCode=1;");
  let stdout = "2026-01-01T00:00:00.000Z";
  let stderr = "assertion A failed: expected 2, received 1; token=private";
  vi.spyOn(BubblewrapIsolationBackend.prototype, "run").mockImplementation(
    async () => ({
      ok: true,
      state: "completed",
      exitCode: 1,
      stdout,
      stderr,
      logs: {
        stdout: { bytes: stdout.length, truncated: false },
        stderr: { bytes: stderr.length, truncated: false },
      },
    }),
  );
  const verify = () =>
    executePackageVerification({
      root,
      dependencyOwner: root,
      signal: new AbortController().signal,
      verification: {
        kind: "static-check",
        id: "same",
        runner: { kind: "node", script: "failure.mjs" },
        args: [],
        classification: "expected-green",
      },
    });
  const first = await verify();
  stdout = "2026-01-02T00:00:00.000Z";
  const second = await verify();
  if (first.kind !== "rejected" || second.kind !== "rejected")
    throw new Error("expected failure");
  expect(first.evidence.failureIdentities).toEqual(
    second.evidence.failureIdentities,
  );
  expect(first.evidence.attributionReliable).toBe(false);
  expect(first.diagnostic?.stderr).toContain("expected 2, received 1");
  expect(first.diagnostic?.stderr).not.toContain("private");
  const feedback = new VerificationFeedback();
  feedback.observe(first);
  expect(feedback.current()[0]?.stderr).toContain("assertion A");
  feedback.observe({ kind: "accepted", evidence: first.evidence });
  expect(feedback.current()).toEqual([]);
  stdout = "x".repeat(80000);
  const third = await verify();
  stderr = "assertion B failed";
  const fourth = await verify();
  if (third.kind !== "rejected" || fourth.kind !== "rejected")
    throw new Error("expected failure");
  expect(third.evidence.failureIdentities).not.toEqual(
    fourth.evidence.failureIdentities,
  );
  expect(third.diagnostic?.stdout.length).toBeLessThan(4200);
});

it("maps repository workspace dependencies into candidate bytes, not host bytes", async () => {
  const root = fixture();
  const candidate = path.join(root, "candidate");
  mkdirSync(path.join(root, "node_modules"));
  mkdirSync(path.join(root, "packages/lib"), { recursive: true });
  mkdirSync(path.join(candidate, "packages/lib"), { recursive: true });
  symlinkSync("../packages/lib", path.join(root, "node_modules/lib"));
  const prepared = await prepareVerificationEnvironment(candidate, root, []);
  try {
    const link = prepared.mounts.find(
      (mount) => mount.target === "/workspace/node_modules",
    )!;
    expect(readlinkSync(path.join(link.source, "lib"))).toBe(
      "/workspace/packages/lib",
    );
    expect(link.source).toContain("dependencies");
  } finally {
    await prepared.cleanup();
  }
});

it.skipIf(process.env.CADENCE_REAL_ISOLATION !== "1")(
  "executes a trusted candidate with mapped workspace links and explicit environment names",
  async () => {
    vi.stubEnv("ABEL_EXECUTION_MODE", "local-trusted");
    vi.stubEnv("ABEL_VERIFICATION_ENV", "CADENCE_TEST_VALUE");
    vi.stubEnv("CADENCE_TEST_VALUE", "expected");
    const root = fixture();
    const candidate = path.join(root, "candidate");
    mkdirSync(path.join(root, "node_modules"));
    mkdirSync(path.join(root, "packages/lib"), { recursive: true });
    mkdirSync(path.join(candidate, "packages/lib"), { recursive: true });
    writeFileSync(
      path.join(root, "packages/lib/index.js"),
      'module.exports="host";',
    );
    writeFileSync(
      path.join(candidate, "packages/lib/index.js"),
      'module.exports="candidate";',
    );
    symlinkSync("../packages/lib", path.join(root, "node_modules/lib"));
    writeFileSync(
      path.join(candidate, "check.cjs"),
      'const assert = require("node:assert/strict"); assert.equal(require("lib"), "candidate"); assert.equal(process.env.CADENCE_TEST_VALUE, "expected");',
    );
    const result = await executePackageVerification({
      root: candidate,
      dependencyOwner: root,
      signal: new AbortController().signal,
      verification: {
        kind: "static-check",
        id: "trusted",
        runner: { kind: "node", script: "check.cjs" },
        args: [],
        classification: "expected-green",
      },
    });
    expect(result).toMatchObject({ kind: "accepted" });
  },
);

it.skipIf(process.env.CADENCE_REAL_ISOLATION !== "1")(
  "settles trusted timeout and cancellation without an isolation fallback",
  async () => {
    const root = fixture();
    const backend = new BubblewrapIsolationBackend({
      localTrusted: true,
      timeoutMs: 50,
      terminateGraceMs: 20,
    });
    expect(
      await backend.run({
        root,
        executable: process.execPath,
        args: ["-e", "setInterval(()=>{}, 1000)"],
        environment: {},
      }),
    ).toMatchObject({ ok: false, code: "isolation-execution-timeout" });
    const signal = new AbortController();
    signal.abort();
    expect(
      await backend.run({
        root,
        executable: process.execPath,
        signal: signal.signal,
      }),
    ).toMatchObject({ state: "cancelled" });
    expect(executionProfile({})).toMatchObject({ mode: "isolated" });
    expect(() => executionProfile({ ABEL_EXECUTION_MODE: "typo" })).toThrow(
      "execution-mode-invalid",
    );
    expect(() => executionProfile({ ABEL_VERIFICATION_ENV: "TOKEN" })).toThrow(
      "requires-trusted-mode",
    );
  },
);

it("keeps transport limits strict", () => {
  expect(
    requestBounds({ ABEL_FIRST_PROGRESS_MS: "1234" }).firstProgressMs,
  ).toBe(1234);
  expect(() => requestBounds({ ABEL_STREAM_IDLE_MS: "NaN" })).toThrow();
});

it("coalesces concurrent scans without reusing completed evidence or cancelling peers", async () => {
  let release!: (value: string) => void;
  let underlying!: AbortSignal;
  const scan = vi.fn(async (_plan: unknown, signal: AbortSignal) => {
    underlying = signal;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  });
  const shared = coalesceVerificationScans(scan);
  const a = new AbortController();
  const b = new AbortController();
  const first = shared({}, a.signal);
  const firstRejected = expect(first).rejects.toThrow();
  const second = shared({}, b.signal);
  await Promise.resolve();
  a.abort();
  expect(underlying.aborted).toBe(false);
  release("identity");
  await firstRejected;
  expect(await second).toBe("identity");
  expect(scan).toHaveBeenCalledTimes(1);
  const third = shared({});
  await Promise.resolve();
  release("new");
  expect(await third).toBe("new");
  expect(scan).toHaveBeenCalledTimes(2);
});

it("expands the quick author example through the original strict compiler", () => {
  const root = fixture();
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "test"));
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  writeFileSync(path.join(root, "src/add.mjs"), "export const add = () => 0;");
  writeFileSync(path.join(root, "test/add.test.mjs"), "export {};");
  const draft = JSON.parse(
    readFileSync(
      path.resolve(
        import.meta.dirname,
        "../config/plan-draft.quick.example.json",
      ),
      "utf8",
    ),
  );
  const before = structuredClone(draft);
  const compiled = compileImplementPlan(draft, {
    consumerRoot: root,
    bindExecutionInputs: true,
  });
  expect(compiled.plan.tasks).toHaveLength(1);
  expect(compiled.plan.tasks[0]?.phases.red).toBeDefined();
  expect(draft).toEqual(before);
  expect(() => expandSingleTaskDraft({ ...draft, tasks: [] })).toThrow();
  draft.singleTask.greenWrite = ["outside.mjs"];
  expect(() =>
    compileImplementPlan(draft, {
      consumerRoot: root,
      bindExecutionInputs: true,
    }),
  ).toThrow();
});

it("inspects empty run storage without creating databases and bounds storage traversal", () => {
  vi.stubEnv("XDG_STATE_HOME", fixture());
  const root = fixture();
  expect(inspectRuns(root).runs).toEqual([]);
  writeFileSync(path.join(root, "data"), "1234");
  expect(storageUsage(root).bytes).toBe(4);
  expect(storageUsage(root, 1).truncated).toBe(true);
});

it("cancels and drains a shared scan when its last subscriber leaves", async () => {
  let aborted = false;
  const scan = coalesceVerificationScans(
    async (_plan, signal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(signal.reason);
          },
          { once: true },
        );
      }),
  );
  const controller = new AbortController();
  const pending = scan({}, controller.signal);
  const rejected = expect(pending).rejects.toThrow();
  await Promise.resolve();
  controller.abort();
  await rejected;
  expect(aborted).toBe(true);
});

it("preserves scoped workspace links in the isolated dependency view", async () => {
  const root = fixture();
  const candidate = path.join(root, "candidate");
  mkdirSync(path.join(root, "node_modules/@scope"), { recursive: true });
  mkdirSync(path.join(root, "packages/lib"), { recursive: true });
  mkdirSync(path.join(candidate, "packages/lib"), { recursive: true });
  symlinkSync("../../packages/lib", path.join(root, "node_modules/@scope/lib"));
  const prepared = await prepareVerificationEnvironment(candidate, root, []);
  try {
    const mount = prepared.mounts.find(
      (entry) => entry.target === "/workspace/node_modules",
    )!;
    expect(readlinkSync(path.join(mount.source, "@scope/lib"))).toBe(
      "/workspace/packages/lib",
    );
  } finally {
    await prepared.cleanup();
  }
});

it.skipIf(process.env.CADENCE_REAL_ISOLATION !== "1")(
  "kills a trusted background descendant that retains stdout",
  async () => {
    const root = fixture();
    const backend = new BubblewrapIsolationBackend({
      localTrusted: true,
      timeoutMs: 2000,
    });
    const result = await backend.run({
      root,
      executable: process.execPath,
      args: [
        "-e",
        `require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'inherit'}).unref()`,
      ],
      environment: {},
    });
    expect(result).toMatchObject({ ok: true, exitCode: 0 });
  },
);

it.skipIf(process.env.CADENCE_REAL_ISOLATION !== "1")(
  "runs a real Vitest report in a trusted dependency copy",
  async () => {
    vi.stubEnv("ABEL_EXECUTION_MODE", "local-trusted");
    const root = fixture();
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ type: "module", scripts: { test: "vitest run" } }),
    );
    writeFileSync(
      path.join(root, "sample.test.js"),
      "import {it,expect} from 'vitest'; it('passes',()=>expect(1).toBe(1));",
    );
    const result = await executePackageVerification({
      root,
      dependencyOwner: path.resolve(import.meta.dirname, ".."),
      signal: new AbortController().signal,
      verification: {
        kind: "vitest",
        id: "trusted-vitest",
        runner: {
          kind: "package-script",
          packageManager: "npm",
          script: "test",
          command: "vitest run",
        },
        testFiles: ["sample.test.js"],
        args: [],
        minTests: 1,
        classification: "expected-green",
      },
    });
    expect(result, JSON.stringify(result)).toMatchObject({
      kind: "accepted",
      evidence: { tests: 1 },
    });
  },
  30000,
);

it("bounds aggregate feedback below the small-model admission allowance", () => {
  const feedback = new VerificationFeedback();
  for (let index = 0; index < 32; index++)
    feedback.observe({
      kind: "unavailable",
      category: "environment",
      code: "missing",
      verificationId: `check-${index}`,
      diagnostic: {
        verificationId: `check-${index}`,
        code: "missing",
        failures: ["x".repeat(2000)],
        stdout: "x".repeat(8000),
        stderr: "x".repeat(8000),
        truncated: true,
        nextStep: "repair environment",
      },
    });
  expect(feedback.current().length).toBeGreaterThan(0);
  expect(Buffer.byteLength(JSON.stringify(feedback.current()))).toBeLessThan(
    6100,
  );
});
