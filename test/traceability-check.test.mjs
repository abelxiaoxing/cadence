import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const roots = [];
afterEach(() =>
  roots.splice(0).forEach((r) => {
    rmSync(r, { recursive: true, force: true });
  }),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), "cadence-map-"));
  roots.push(base);
  const root = path.join(base, "repository");
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  cpSync(
    new URL("../scripts/traceability-check.mjs", import.meta.url),
    path.join(root, "scripts/traceability-check.mjs"),
  );
  writeFileSync(
    path.join(root, "prd.md"),
    "- [ ] **G6-AC1** honest coverage\n",
  );
  writeFileSync(path.join(root, "package.json"), "{}\n");
  writeFileSync(
    path.join(root, "check.test.ts"),
    'it("actual safety assertion", () => {});\n',
  );
  writeFileSync(path.join(root, "source.ts"), "export const safety = true;\n");
  const v = {
    id: "check-1",
    path: "check.test.ts",
    assertions: ["actual safety assertion"],
    inputPaths: ["prd.md", "package.json", "check.test.ts", "source.ts"],
    required: true,
    status: "planned",
    evidence: [],
  };
  const map = {
    formatVersion: 1,
    prd: "prd.md",
    criteria: [
      {
        id: "G6-AC1",
        parentCriteria: ["AC1"],
        required: true,
        status: "planned",
        verification: [v],
      },
    ],
    releaseLanes: [
      {
        id: "local",
        required: true,
        status: "planned",
        checks: ["check-1"],
        platform: "linux-x64",
      },
    ],
  };
  const run = (args = ["--map", "map.json"]) => {
    writeFileSync(path.join(root, "map.json"), JSON.stringify(map));
    return spawnSync(
      process.execPath,
      [path.join(root, "scripts/traceability-check.mjs"), ...args],
      { cwd: root, encoding: "utf8", timeout: 5000 },
    );
  };
  const passed = () => {
    const log = path.join(base, "closed.log");
    writeFileSync(
      log,
      "actual closed fixture evidence, not product qualification\n",
    );
    v.status = "passed";
    map.criteria[0].status = "passed";
    map.releaseLanes[0].status = "passed";
    v.evidence.push({
      command: ["node", "never-executed-by-checker"],
      exitCode: 0,
      outcome: "passed",
      lane: "local",
      platform: "linux-x64",
      runtime: "node-26.7.0",
      inputs: v.inputPaths.map((p) => ({
        path: p,
        sha256: hash(readFileSync(path.join(root, p))),
      })),
      locator: log,
      sha256: hash(readFileSync(log)),
    });
  };
  return { root, map, v, run, passed };
}
it("requires an explicit nonempty map and distinguishes valid references from executed evidence", () => {
  const f = fixture();
  expect(f.run([]).status).toBe(1);
  expect(f.run().status).toBe(0);
  expect(f.run().stdout).toContain("not execution or release evidence");
  expect(f.run(["--map", "map.json", "--require-passed"]).status).toBe(1);
  f.map.criteria = [];
  expect(f.run().status).toBe(1);
});
it.each(["planned", "failed", "blocked", "unavailable"])(
  "refuses required %s evidence in release mode",
  (status) => {
    const f = fixture();
    f.v.status = status;
    f.map.criteria[0].status = status;
    f.map.releaseLanes[0].status = status;
    expect(f.run(["--map", "map.json", "--require-passed"]).status).toBe(1);
  },
);
it.each([
  (f) => f.map.criteria.push(structuredClone(f.map.criteria[0])),
  (f) => f.map.criteria[0].verification.push(structuredClone(f.v)),
  (f) => (f.map.criteria[0].id = "G6-AC2"),
  (f) => (f.map.criteria[0].verification = []),
  (f) => (f.v.required = false),
  (f) => (f.v.assertions = ["nonexistent title"]),
  (f) => (f.v.status = "skipped"),
  (f) => (f.v.path = "../outside"),
  (f) => (f.v.path = "/etc/passwd"),
  (f) => (f.v.path = "absent.ts"),
  (f) => (f.v.path = "scripts/../source.ts"),
  (f) => (f.v.inputPaths = ["package.json", "check.test.ts", "source.ts"]),
  (f) => (f.map.releaseLanes[0].checks = ["dangling"]),
  (f) => (f.map.releaseLanes = []),
  (f) => (f.map.releaseLanes[0].runtime = "node-26.7.0"),
  (f) => (f.map.criteria[0].unrecognized = "not admitted"),
])(
  "rejects malformed, duplicate, dangling, missing and partial maps %#",
  (mutate) => {
    const f = fixture();
    mutate(f);
    expect(f.run().status).toBe(1);
  },
);
it("refuses links at the file and directory boundary", () => {
  const f = fixture();
  symlinkSync(path.join(f.root, "check.test.ts"), path.join(f.root, "link.ts"));
  f.v.path = "link.ts";
  expect(f.run().status).toBe(1);
  symlinkSync(
    f.root,
    path.join(f.root, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  f.v.path = "linked/check.test.ts";
  expect(f.run().status).toBe(1);
});
it("validates bound external evidence without executing its command", () => {
  const f = fixture();
  f.passed();
  f.v.evidence[0].command = [
    process.execPath,
    "-e",
    `require('fs').writeFileSync(${JSON.stringify(path.join(f.root, "forbidden"))},'bad')`,
  ];
  expect(f.run(["--map", "map.json", "--require-passed"]).status).toBe(0);
  expect(() => readFileSync(path.join(f.root, "forbidden"))).toThrow();
  writeFileSync(path.join(f.root, "source.ts"), "changed source\n");
  expect(f.run().stderr).toContain("traceability-stale");
});
it.each([
  (f) => (f.v.evidence = []),
  (f) => (f.v.evidence[0].exitCode = 1),
  (f) => (f.v.evidence[0].outcome = "failed"),
  (f) => f.v.evidence[0].inputs.pop(),
  (f) => (f.v.evidence[0].sha256 = "0".repeat(64)),
  (f) => (f.v.evidence[0].platform = "win32-x64"),
  (f) => delete f.v.evidence[0].runtime,
  (f) => (f.v.evidence[0].runtime = ""),
  (f) => (f.v.evidence[0].runtime = "*"),
  (f) => (f.v.evidence[0].runtime = "x".repeat(129)),
  (f) => (f.v.evidence[0].lane = "other"),
  (f) => (f.v.evidence[0].locator = path.join(f.root, "source.ts")),
])(
  "refuses absent, failed, stale, partial or inapplicable passed evidence %#",
  (mutate) => {
    const f = fixture();
    f.passed();
    mutate(f);
    expect(f.run(["--map", "map.json", "--require-passed"]).status).toBe(1);
  },
);

it.each(["node-22.13.0-pi-0.84.3", "node-26.7.0-pi-0.90.0"])(
  "accepts observed runtime %s without a version prerequisite for the same lane",
  (runtime) => {
    const f = fixture();
    f.passed();
    f.v.evidence[0].runtime = runtime;
    expect(f.run(["--map", "map.json", "--require-passed"]).status).toBe(0);
  },
);
