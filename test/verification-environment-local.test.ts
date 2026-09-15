import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { StructuredVerificationContract } from "../src/contracts.ts";
import { captureVerificationEnvironmentIdentity } from "../src/verification-environment.ts";

it("observes a missing local runner without making it a prerequisite for independent checks", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-local-capability-"));
  const verification: StructuredVerificationContract = {
    kind: "static-check",
    id: "external-check",
    runner: { kind: "local-binary", executable: "external-check" },
    args: [],
    classification: "expected-green",
  };
  try {
    const absent = await captureVerificationEnvironmentIdentity(root, [
      verification,
    ]);
    expect(absent).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await captureVerificationEnvironmentIdentity(root, [verification]),
    ).toBe(absent);
    mkdirSync(path.join(root, "node_modules/.bin"), { recursive: true });
    const runner = path.join(root, "node_modules/.bin/external-check");
    writeFileSync(runner, "#!/usr/bin/env node\nprocess.exit(0);\n");
    chmodSync(runner, 0o755);
    expect(
      await captureVerificationEnvironmentIdentity(root, [verification]),
    ).not.toBe(absent);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
