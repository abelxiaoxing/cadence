import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Activation } from "../src/activation.ts";
import { snapshotFiles } from "../src/file-snapshot.ts";
import { Runtime } from "../src/runtime.ts";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-runtime-readiness-"));
  roots.push(root);
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "node_modules/.bin"), { recursive: true });
  writeFileSync(path.join(root, "src/value.ts"), "export const value = 1;\n");
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
  );
  writeFileSync(path.join(root, "node_modules/.bin/tsc"), "#!/bin/sh\n", {
    mode: 0o755,
  });
  return root;
}

describe("Implement verification readiness", () => {
  it("rejects a missing Gate-B-approved script before task registration or Red", async () => {
    const root = fixture();
    const activation = new Activation();
    activation.request();
    activation.activate();
    const runtime = new Runtime({
      activation,
      parentPayloadBridge: new PassthroughParentPayloadBridge(),
    });
    const red = {
      kind: "package-script",
      id: "missing-red-script",
      packageManager: "npm",
      script: "test:missing",
      command: "vitest run",
      args: [],
      classification: "expected-red",
      expectedFailure: "[RUNTIME-READINESS:missing]",
    } as const;
    const green = {
      kind: "package-script",
      id: "missing-green-script",
      packageManager: "npm",
      script: "test:missing",
      command: "vitest run",
      args: [],
      classification: "expected-green",
    } as const;
    const request = {
      stage: "abel-implement",
      kind: "open-task",
      boundary: {
        changeId: "runtime-readiness",
        taskId: "missing-script",
        objective: "Reject an impossible verification contract before Red",
        roots: ["."],
        context: { agents: "fixture", contract: "Gate B fixture" },
        phases: {
          red: {
            read: ["src/value.ts"],
            write: ["src/value.ts"],
            verification: red,
          },
          green: {
            read: ["src/value.ts"],
            write: ["src/value.ts"],
            verification: green,
          },
        },
        scheduling: { conflicts: [], resources: [] },
        agents: { impact: "none", managedOnly: true },
        approvedDependencies: [],
        impactClosure: {
          changedSurfaces: ["none"],
          searchEvidence: [],
          relatedTests: [],
          affectedSuite: [],
        },
      },
      attempt: {
        changeId: "runtime-readiness",
        taskId: "missing-script",
        requestId: "missing-script:red:0",
        phase: "red",
        snapshot: snapshotFiles(root, ["src/value.ts"]),
      },
    };

    const result = await runtime.execute("run", { request }, {
      cwd: root,
      model: { provider: "fixture", id: "fixture", name: "fixture" },
      modelRegistry: {},
    } as never);

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: "verification-adapter", code: "script-missing" },
    });
    expect(
      (
        runtime as never as { registry: { values(): unknown[] } }
      ).registry.values(),
    ).toEqual([]);
  });
});
