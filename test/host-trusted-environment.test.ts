import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { executionProfile } from "../src/execution-profile.ts";
import {
  assertExecutionsSettled,
  isExecutionRetained,
  retainExecution,
} from "../src/execution-retention.ts";
import { executePackageVerification } from "../src/package-verification.ts";
import { prepareVerificationEnvironmentIo } from "../src/verification-environment-io.ts";
import { WindowsJobBackend } from "../src/windows-job-backend.ts";

const roots: string[] = [];
function temp() {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-host-env-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it("copies dependency bytes, redirects workspace junctions and runner scripts into the candidate, and provides disposable native directories", () => {
  const owner = temp(),
    candidate = temp(),
    scratch = temp();
  mkdirSync(path.join(owner, "node_modules/tool"), { recursive: true });
  mkdirSync(path.join(owner, "node_modules/@scope"));
  mkdirSync(path.join(owner, "packages/lib"), { recursive: true });
  mkdirSync(path.join(candidate, "packages/lib"), { recursive: true });
  writeFileSync(path.join(owner, "node_modules/tool/cli.js"), "original");
  writeFileSync(path.join(owner, "packages/lib/value"), "host");
  writeFileSync(path.join(candidate, "packages/lib/value"), "candidate");
  symlinkSync(
    path.join(owner, "packages/lib"),
    path.join(owner, "node_modules/@scope/lib"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const result = prepareVerificationEnvironmentIo(
    candidate,
    owner,
    [
      {
        command: "tool",
        executablePath: process.execPath,
        fixedArgs: [path.join(owner, "node_modules/tool/cli.js")],
      },
    ],
    executionProfile({ ABEL_EXECUTION_MODE: "host-trusted" }),
    { PATH: path.dirname(process.execPath), SystemRoot: "C:\\Windows" },
    () => {},
    scratch,
  );
  expect(result.mounts).toEqual([]);
  expect(result.bindings[0].fixedArgs).toEqual([
    path.join(candidate, "node_modules/tool/cli.js"),
  ]);
  expect(result.environment.TEMP).toBe(path.join(scratch, "tmp"));
  expect(result.environment.USERPROFILE).toBe(path.join(scratch, "home"));
  expect((result.environment as Record<string, string>).SystemRoot).toBe(
    "C:\\Windows",
  );
  expect(result.environment.PATH.split(path.delimiter)).toContain(
    path.dirname(process.execPath),
  );
  expect(
    readFileSync(path.join(candidate, "node_modules/@scope/lib/value"), "utf8"),
  ).toBe("candidate");
  writeFileSync(path.join(candidate, "node_modules/tool/cli.js"), "changed");
  expect(
    readFileSync(path.join(owner, "node_modules/tool/cli.js"), "utf8"),
  ).toBe("original");
});
it("retains uncertain work and blocks re-admission without treating a persisted marker as a live PID", () => {
  const owner = temp(),
    candidate = temp();
  const lease = retainExecution(owner, [candidate]);
  expect(isExecutionRetained(candidate)).toBe(true);
  expect(() => assertExecutionsSettled(owner)).not.toThrow();
  expect(() => assertExecutionsSettled(owner, true)).toThrow(
    "isolation-termination-unconfirmed",
  );
  lease.uncertain();
  expect(() => assertExecutionsSettled(owner)).toThrow(
    "isolation-termination-unconfirmed",
  );
  expect(readdirSync(owner)).toHaveLength(1);
  lease.settled();
  expect(isExecutionRetained(candidate)).toBe(false);
  // A marker from a different process/session also blocks; no module cache required.
  writeFileSync(path.join(owner, ".cadence-execution-interrupted.json"), "{}");
  expect(() => assertExecutionsSettled(owner)).toThrow(
    "isolation-termination-unconfirmed",
  );
});
it("never converts unconfirmed termination with an expected-red contract into product evidence or cleans its resources", async () => {
  vi.stubEnv("ABEL_EXECUTION_MODE", "host-trusted");
  const owner = temp(),
    candidate = temp(),
    leases = temp();
  writeFileSync(path.join(candidate, "check.mjs"), "throw Error('RED');");
  vi.spyOn(WindowsJobBackend.prototype, "run").mockResolvedValue({
    ok: false,
    state: "paused",
    code: "isolation-termination-unconfirmed",
  });
  const result = await executePackageVerification({
    root: candidate,
    dependencyOwner: owner,
    executionOwnerRoot: leases,
    verification: {
      kind: "static-check",
      id: "uncertain",
      runner: { kind: "node", script: "check.mjs" },
      args: [],
      classification: "expected-red",
      expectedFailure: "RED",
    },
    signal: new AbortController().signal,
  });
  expect(result).toMatchObject({
    kind: "unavailable",
    category: "environment",
    code: "isolation-termination-unconfirmed",
  });
  expect(isExecutionRetained(candidate)).toBe(true);
  const retained = JSON.parse(
    readFileSync(path.join(leases, readdirSync(leases)[0]), "utf8"),
  );
  roots.push(retained.roots[1]);
  expect(readdirSync(retained.roots[1])).toContain("reports");
});
