import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectOpenSpecDelivery,
  OpenSpecCliError,
  resolveOpenSpecInvocation,
} from "../src/openspec-cli.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function temporary() {
  const root = mkdtempSync(
    path.join(tmpdir(), "cadence CLI 中文 & %PATH% ! (test)-"),
  );
  roots.push(root);
  return root;
}

const cli = `
const args = process.argv.slice(2);
const command = args[0];
const change = command === 'status' ? args[2] : args[1];
const status = {
  changeName: change, schemaName: 'spec-driven',
  isPlanningComplete: true, isComplete: true,
  artifactPaths: { proposal: { existingOutputPaths: [
    'openspec/changes/' + change + '/proposal.md',
    'openspec/changes/' + change + '/proposal.md'
  ] } }
};
const validation = { items: [{ id: change, valid: true }] };
console.log(JSON.stringify(command === 'status' ? status : validation));
`;

function fixture(source = cli, prefix = temporary()) {
  const packageRoot = path.join(prefix, "node_modules/@fission-ai/openspec");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@fission-ai/openspec",
      bin: { openspec: "entry.cjs" },
    }),
  );
  const entry = path.join(packageRoot, "entry.cjs");
  writeFileSync(entry, source);
  // Intentionally unexecutable garbage: successful calls MUST bypass the shim.
  writeFileSync(
    path.join(
      prefix,
      process.platform === "win32" ? "openspec.cmd" : "openspec",
    ),
    "NEVER EXECUTE THIS SHIM",
  );
  const consumerRoot = temporary();
  const environment = {
    ...process.env,
    PATH: prefix,
    ABEL_OPENSPEC_PACKAGE_ROOT: undefined,
    ABEL_OPENSPEC_NODE: process.execPath,
  };
  return { packageRoot, consumerRoot, environment, prefix, entry };
}

describe("shell-free OpenSpec CLI", () => {
  it("discovers npm prefix bin metadata and preserves special-character cwd and relative output", async () => {
    const item = fixture();
    expect(
      resolveOpenSpecInvocation(item.consumerRoot, item.environment),
    ).toEqual({
      executable: realpathSync(process.execPath),
      entry: realpathSync(item.entry),
    });
    await expect(
      inspectOpenSpecDelivery(item.consumerRoot, "example-change", {
        environment: item.environment,
      }),
    ).resolves.toEqual({
      change: "example-change",
      schema: "spec-driven",
      planningComplete: true,
      strictValid: true,
      artifactPaths: ["proposal.md"],
    });
  });

  it("resolves Unix npm/Bun symlink targets using package bin metadata", () => {
    if (process.platform === "win32") return;
    const item = fixture();
    const bin = temporary();
    symlinkSync(item.entry, path.join(bin, "openspec"));
    expect(
      resolveOpenSpecInvocation(item.consumerRoot, {
        ...item.environment,
        PATH: bin,
      }).entry,
    ).toBe(realpathSync(item.entry));
  });

  it.skipIf(process.platform !== "win32")(
    "handles Path casing and uppercase npm CMD names",
    async () => {
      const item = fixture();
      rmSync(path.join(item.prefix, "openspec.cmd"));
      writeFileSync(path.join(item.prefix, "OPENSPEC.CMD"), "do not execute");
      const environment: NodeJS.ProcessEnv = { ...item.environment };
      for (const key of Object.keys(environment))
        if (key.toUpperCase() === "PATH") delete environment[key];
      environment.Path = item.prefix;
      await expect(
        inspectOpenSpecDelivery(item.consumerRoot, "a--b", { environment }),
      ).resolves.toMatchObject({ strictValid: true });
    },
  );

  it("does not replace a symlink-selected version with an adjacent installation", () => {
    if (process.platform === "win32") return;
    const adjacent = fixture();
    const selected = fixture();
    rmSync(path.join(adjacent.prefix, "openspec"));
    symlinkSync(selected.entry, path.join(adjacent.prefix, "openspec"));
    expect(
      resolveOpenSpecInvocation(adjacent.consumerRoot, adjacent.environment)
        .entry,
    ).toBe(realpathSync(selected.entry));
    rmSync(selected.entry);
    expect(() =>
      resolveOpenSpecInvocation(adjacent.consumerRoot, adjacent.environment),
    ).toThrowError(OpenSpecCliError);
  });

  it("retains a real OS launch failure without exposing command paths", async () => {
    if (process.platform === "win32") return;
    const item = fixture();
    chmodSync(item.entry, 0o600);
    await expect(
      inspectOpenSpecDelivery(item.consumerRoot, "example", {
        environment: { ...item.environment, ABEL_OPENSPEC_NODE: item.entry },
      }),
    ).rejects.toMatchObject({
      diagnostic: {
        command: "status",
        phase: "spawn",
        reason: "launch-failed",
        systemCode: "EACCES",
      },
    });
  });

  it("classifies a missing consumer cwd and bounds error metadata", async () => {
    const item = fixture();
    await expect(
      inspectOpenSpecDelivery(
        path.join(item.consumerRoot, "missing"),
        "example",
        { environment: item.environment },
      ),
    ).rejects.toMatchObject({
      diagnostic: { reason: "cwd-unavailable", systemCode: "ENOENT" },
    });
  });

  it("honors explicit package roots and never silently falls back from invalid configuration", () => {
    const item = fixture();
    expect(
      resolveOpenSpecInvocation(item.consumerRoot, {
        ...item.environment,
        PATH: "",
        ABEL_OPENSPEC_PACKAGE_ROOT: item.packageRoot,
      }).entry,
    ).toBe(realpathSync(item.entry));
    for (const root of [
      "relative/path",
      path.join(item.prefix, "missing"),
      "",
    ]) {
      expect(() =>
        resolveOpenSpecInvocation(item.consumerRoot, {
          ...item.environment,
          ABEL_OPENSPEC_PACKAGE_ROOT: root,
        }),
      ).toThrowError(OpenSpecCliError);
    }
  });

  it("ignores cwd and repository PATH entries, with no network/package-manager fallback", () => {
    const item = fixture();
    expect(() =>
      resolveOpenSpecInvocation(item.prefix, {
        ...item.environment,
        PATH: `${item.prefix}${path.delimiter}.${path.delimiter}`,
      }),
    ).toThrowError(
      expect.objectContaining({
        diagnostic: expect.objectContaining({
          reason: "installation-not-found",
        }),
      }),
    );
  });

  it("does not switch to a second version when the first installation is broken", () => {
    const first = fixture();
    const second = fixture();
    rmSync(first.entry);
    const resolve = () =>
      resolveOpenSpecInvocation(first.consumerRoot, {
        ...first.environment,
        PATH: [first.prefix, second.prefix].join(path.delimiter),
      });
    let unexpected: unknown;
    try {
      unexpected = resolve();
    } catch {}
    expect(
      () => resolve(),
      JSON.stringify({
        first: first.prefix,
        second: second.prefix,
        unexpected,
      }),
    ).toThrowError(
      expect.objectContaining({
        diagnostic: expect.objectContaining({ reason: "installation-invalid" }),
      }),
    );
  });

  it("rejects escaping bin metadata and non-Node runtimes without executing them", () => {
    const item = fixture();
    writeFileSync(
      path.join(item.packageRoot, "package.json"),
      JSON.stringify({
        name: "@fission-ai/openspec",
        bin: { openspec: "../../../openspec" },
      }),
    );
    expect(() =>
      resolveOpenSpecInvocation(item.consumerRoot, item.environment),
    ).toThrowError(OpenSpecCliError);
    expect(() =>
      resolveOpenSpecInvocation(item.consumerRoot, {
        ...item.environment,
        ABEL_OPENSPEC_NODE: "node.cmd",
      }),
    ).toThrowError(
      expect.objectContaining({
        diagnostic: expect.objectContaining({ reason: "runtime-unavailable" }),
      }),
    );
  });

  it("rejects unsafe change names before launch", async () => {
    const item = fixture();
    for (const change of [
      "--help",
      "../escape",
      "a&whoami",
      "a\nb",
      "",
      "a/b",
    ]) {
      await expect(
        inspectOpenSpecDelivery(item.consumerRoot, change, {
          environment: item.environment,
        }),
      ).rejects.toMatchObject({ diagnostic: { reason: "change-invalid" } });
    }
  });

  it("treats exit 1 plus a valid failure report as strict invalid, not unavailable", async () => {
    const item = fixture(
      cli.replace("valid: true", "valid: false") +
        "if (command === 'validate') process.exitCode = 1;",
    );
    await expect(
      inspectOpenSpecDelivery(item.consumerRoot, "example", {
        environment: item.environment,
      }),
    ).resolves.toMatchObject({ strictValid: false });
  });

  it.each([
    ["isComplete: true", true],
    ["isComplete: false", false],
    ["isPlanningComplete: true, isComplete: true", true],
    ["isPlanningComplete: false, isComplete: true", false],
    ["isPlanningComplete: true, isComplete: false", false],
    ["isPlanningComplete: false, isComplete: false", false],
  ])("interprets completion fields (%s)", async (fields, planningComplete) => {
    const item = fixture(
      cli.replace("isPlanningComplete: true, isComplete: true", fields),
    );
    await expect(
      inspectOpenSpecDelivery(item.consumerRoot, "example", {
        environment: item.environment,
      }),
    ).resolves.toMatchObject({ planningComplete });
  });

  it.each([
    "",
    "isPlanningComplete: true",
    "isComplete: null",
    "isComplete: 'true'",
    "isPlanningComplete: null, isComplete: true",
    "isPlanningComplete: 'true', isComplete: true",
  ])("rejects malformed completion fields (%s)", async (fields) => {
    const item = fixture(
      cli.replace(
        "isPlanningComplete: true, isComplete: true,",
        fields ? `${fields},` : "",
      ),
    );
    await expect(
      inspectOpenSpecDelivery(item.consumerRoot, "example", {
        environment: item.environment,
      }),
    ).rejects.toMatchObject({
      diagnostic: {
        command: "status",
        phase: "protocol",
        reason: "schema-invalid",
      },
    });
  });

  it.each([
    ["console.log('secret output');", "json-invalid", "protocol"],
    ["process.exit(2);", "exit-nonzero", "execution"],
    [
      cli.replace("schemaName: 'spec-driven'", "schemaName: null"),
      "schema-invalid",
      "protocol",
    ],
    [
      cli.replace("'/proposal.md'", "'/../../../../escape'"),
      "schema-invalid",
      "protocol",
    ],
    [
      `${cli}if (command === 'validate') process.exitCode = 1;`,
      "schema-invalid",
      "protocol",
    ],
    [cli.replace("id: change", "id: 'other'"), "schema-invalid", "protocol"],
  ])(
    "classifies malformed or failed output without leaking it (%#)",
    async (source, reason, phase) => {
      const item = fixture(source);
      const error = await inspectOpenSpecDelivery(
        item.consumerRoot,
        "example",
        { environment: item.environment },
      ).catch((error: unknown) => error);
      expect(error).toMatchObject({ diagnostic: { reason, phase } });
      expect(JSON.stringify(error)).not.toContain(item.prefix);
      expect(JSON.stringify(error)).not.toContain("secret output");
    },
  );

  it("bounds time and both stdout/stderr output", async () => {
    const item = fixture("setInterval(() => {}, 1000);");
    await expect(
      inspectOpenSpecDelivery(item.consumerRoot, "example", {
        environment: item.environment,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ diagnostic: { reason: "timeout" } });
    for (const stream of ["stdout", "stderr"]) {
      writeFileSync(item.entry, `process.${stream}.write('x'.repeat(10000));`);
      await expect(
        inspectOpenSpecDelivery(item.consumerRoot, "example", {
          environment: item.environment,
          maxBuffer: 100,
        }),
      ).rejects.toMatchObject({ diagnostic: { reason: "output-limit" } });
    }
  });

  it("cancels both children and handles pre-aborted calls", async () => {
    const item = fixture("setInterval(() => {}, 1000);");
    const controller = new AbortController();
    const pending = inspectOpenSpecDelivery(item.consumerRoot, "example", {
      environment: item.environment,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      diagnostic: { reason: "cancelled" },
    });
    await expect(
      inspectOpenSpecDelivery(item.consumerRoot, "example", {
        environment: item.environment,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ diagnostic: { reason: "cancelled" } });
  });

  it("waits for an independently running sibling after one command fails", async () => {
    const item = fixture(`
      const fs = require('node:fs');
      if (process.argv[2] === 'status') process.exit(2);
      setTimeout(() => { fs.writeFileSync('sibling-finished', 'yes'); console.log('{}'); }, 150);
    `);
    await expect(
      inspectOpenSpecDelivery(item.consumerRoot, "example", {
        environment: item.environment,
      }),
    ).rejects.toMatchObject({
      diagnostic: { command: "status", reason: "exit-nonzero", exitCode: "2" },
    });
    expect(existsSync(path.join(item.consumerRoot, "sibling-finished"))).toBe(
      true,
    );
  });

  it("does not return cancellation until both started Node processes have exited", async () => {
    const item = fixture(`
      require('node:fs').writeFileSync(process.argv[2] + '.pid', String(process.pid));
      setInterval(() => {}, 1000);
    `);
    const controller = new AbortController();
    const pending = inspectOpenSpecDelivery(item.consumerRoot, "example", {
      environment: item.environment,
      signal: controller.signal,
    });
    // Attach rejection observation immediately, before waiting for child startup.
    const result = pending.catch((error: unknown) => error);
    const files = ["status", "validate"].map((name) =>
      path.join(item.consumerRoot, `${name}.pid`),
    );
    try {
      await expect
        .poll(() => files.every((file) => existsSync(file)))
        .toBe(true);
    } finally {
      controller.abort();
    }
    expect(await result).toMatchObject({ diagnostic: { reason: "cancelled" } });
    for (const file of files) {
      const pid = Number(readFileSync(file, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    }
  });

  it("retains only allowlisted system error codes", () => {
    expect(
      new OpenSpecCliError("status", "spawn", "launch-failed", {
        systemCode: "ENOENT",
      }).diagnostic.systemCode,
    ).toBe("ENOENT");
    expect(
      new OpenSpecCliError("status", "spawn", "launch-failed", {
        systemCode: "private-secret",
      }).diagnostic.systemCode,
    ).toBeUndefined();
  });
});

describe.skipIf(process.env.CADENCE_REAL_OPENSPEC !== "1")(
  "real npm-global OpenSpec contract",
  () => {
    it("loads the PATH-selected installation and strictly validates a real change", async () => {
      const root = temporary();
      const changeRoot = path.join(root, "openspec/changes/real-change");
      mkdirSync(path.join(changeRoot, "specs/example"), { recursive: true });
      writeFileSync(
        path.join(root, "openspec/config.yaml"),
        "schema: spec-driven\n",
      );
      writeFileSync(
        path.join(changeRoot, "proposal.md"),
        "## Why\n\nTest compatibility.\n\n## What Changes\n\n- Add compatibility.\n\n## Capabilities\n\n### New Capabilities\n- `example`: compatibility.\n\n## Impact\n\nCLI only.\n",
      );
      writeFileSync(
        path.join(changeRoot, "design.md"),
        "## Decisions\n\nUse Node.\n",
      );
      writeFileSync(
        path.join(changeRoot, "tasks.md"),
        "## 1. Work\n\n- [ ] 1.1 Add compatibility\n",
      );
      const spec = path.join(changeRoot, "specs/example/spec.md");
      writeFileSync(
        spec,
        "## ADDED Requirements\n\n### Requirement: Compatibility\nThe CLI SHALL work across platforms.\n\n#### Scenario: Windows CLI\n- **WHEN** invoked\n- **THEN** it succeeds\n",
      );
      // No explicit root override: exercises npm -g/custom-prefix discovery.
      const environment = {
        ...process.env,
        ABEL_OPENSPEC_PACKAGE_ROOT: undefined,
        ABEL_OPENSPEC_NODE: process.execPath,
      };
      await expect(
        inspectOpenSpecDelivery(root, "real-change", { environment }),
      ).resolves.toMatchObject({
        strictValid: true,
        planningComplete: true,
        artifactPaths: [
          "design.md",
          "proposal.md",
          "specs/example/spec.md",
          "tasks.md",
        ],
      });
      writeFileSync(
        spec,
        "## ADDED Requirements\n\n### Requirement: Compatibility\nMissing normative keyword and scenarios.\n",
      );
      await expect(
        inspectOpenSpecDelivery(root, "real-change", { environment }),
      ).resolves.toMatchObject({ strictValid: false });
      if (process.platform === "win32") {
        // Regression evidence: npm creates .cmd, not a native executable.
        await expect(
          promisify(execFile)("openspec", ["--version"], { env: environment }),
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
    }, 60_000);
  },
);
