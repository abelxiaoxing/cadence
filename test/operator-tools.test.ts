import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { inspectConsumer } from "../src/operator-tools.ts";
import * as capability from "../src/verification-capability.ts";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: "probe", stderr: "" })),
}));
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  });
});
function fixture(
  packageManager?: unknown,
  locks = ["bun.lock", "package-lock.json"],
) {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-doctor-"));
  roots.push(root);
  mkdirSync(path.join(root, "src"));
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ packageManager, scripts: { test: "node test.mjs" } }),
  );
  for (const lock of locks)
    writeFileSync(path.join(root, lock), "fixture-lock");
  const probe = vi
    .spyOn(capability, "validateVerificationAdapterCapability")
    .mockReturnValue({
      ok: false,
      diagnostic: {
        code: "runner-missing",
        verificationId: "doctor-test",
        message: "unavailable",
      },
    } as never);
  return { root, probe };
}
it("uses the project declaration despite multiple lockfiles and names the unavailable runner", () => {
  const { root, probe } = fixture("npm@10.0.0");
  const result = inspectConsumer(root);
  expect(result).toMatchObject({
    selectedPackageManager: "npm",
    selectionSource: "package.json",
    ambiguousLockfiles: true,
    lockfiles: ["bun.lock", "package-lock.json"],
  });
  expect(probe).toHaveBeenCalledWith(
    root,
    expect.objectContaining({ packageManager: "npm" }),
  );
  expect(result.checks).toContainEqual(
    expect.objectContaining({
      name: "script:test",
      detail: "npm:runner-missing",
    }),
  );
  expect(readFileSync(path.join(root, "bun.lock"), "utf8")).toBe(
    "fixture-lock",
  );
});
it("blocks ambiguous or unsupported selection before probing a runner", () => {
  const { root, probe } = fixture();
  expect(inspectConsumer(root)).toMatchObject({
    selectedPackageManager: null,
    selectionSource: "ambiguous",
    ok: false,
  });
  expect(probe).not.toHaveBeenCalled();
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      packageManager: "private-unsupported",
      scripts: { test: "node test.mjs" },
    }),
  );
  const result = inspectConsumer(root);
  expect(result).toMatchObject({
    selectedPackageManager: null,
    selectionSource: "invalid-declaration",
    ok: false,
  });
  expect(JSON.stringify(result)).not.toContain("private-unsupported");
  expect(probe).not.toHaveBeenCalled();
});
it.each([
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
])(
  "labels %s inference rather than claiming a project declaration",
  (lock, manager) => {
    const { root } = fixture(undefined, [lock]);
    expect(inspectConsumer(root)).toMatchObject({
      selectedPackageManager: manager,
      selectionSource: "lockfile",
      ambiguousLockfiles: false,
    });
  },
);
it("labels the no-lock npm default and treats two Bun formats as the same manager", () => {
  const { root } = fixture(undefined, []);
  expect(inspectConsumer(root)).toMatchObject({
    selectedPackageManager: "npm",
    selectionSource: "default",
  });
  writeFileSync(path.join(root, "bun.lock"), "");
  writeFileSync(path.join(root, "bun.lockb"), "");
  expect(inspectConsumer(root)).toMatchObject({
    selectedPackageManager: "bun",
    selectionSource: "lockfile",
    ambiguousLockfiles: false,
  });
});
