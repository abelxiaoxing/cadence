import {
  chmodSync,
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
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as verificationCapability from "../src/verification-capability.ts";
import {
  bindCurrentVerificationCapability,
  bindDraftVerificationInputs,
  commonDirectory,
  isVerificationCapabilityCurrent,
  resolveVerificationRunner,
  validateVerificationAdapterCapability,
  validateVerificationCapability,
  verificationRunnerFiles,
} from "../src/verification-capability.ts";
import {
  captureVerificationEnvironmentIdentity,
  prepareVerificationEnvironment,
} from "../src/verification-environment.ts";
import { verificationEnvironmentDigest } from "../src/verification-identity.ts";

const fixtures = fileURLToPath(
  new URL("./fixtures/verification-consumers", import.meta.url),
);
const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function consumer(kind: "npm" | "bun"): string {
  const root = mkdtempSync(path.join(tmpdir(), `cadence-${kind}-consumer-`));
  roots.push(root);
  cpSync(path.join(fixtures, kind), root, { recursive: true });
  mkdirSync(path.join(root, "node_modules/.bin"), { recursive: true });
  for (const executable of ["vitest", "tsc", "vite", "prisma"]) {
    const target = path.join(root, "node_modules", `${executable}.js`);
    writeFileSync(target, "#!/usr/bin/env node\n", { mode: 0o755 });
    symlinkSync(
      path.posix.join("..", `${executable}.js`),
      path.join(root, "node_modules/.bin", executable),
    );
  }
  return root;
}

function windowsRunnerFixture(root: string) {
  const runnerDirectory = path.join(root, "windows-runners");
  const npmBin = path.join(runnerDirectory, "node_modules/npm/bin");
  mkdirSync(npmBin, { recursive: true });
  const node = path.join(runnerDirectory, "NODE.EXE");
  const npm = path.join(runnerDirectory, "NPM.CMD");
  const npx = path.join(runnerDirectory, "nPx.CmD");
  const npmCli = path.join(npmBin, "npm-cli.js");
  const npxCli = path.join(npmBin, "npx-cli.js");
  for (const file of [node, npm, npx, npmCli, npxCli]) {
    writeFileSync(file, "fixture\n", { mode: 0o644 });
    chmodSync(file, 0o644);
  }
  return {
    node,
    npmCli,
    npxCli,
    environment: {
      platform: "win32" as const,
      path: `${runnerDirectory}${path.delimiter}${runnerDirectory}`,
      pathExt: ".PS1;.EXE;.exe;.CMD;.cmd;.EXE",
      pathDelimiter: path.delimiter,
    },
  };
}

const npmVitest = {
  kind: "vitest",
  id: "npm-vitest-target",
  runner: {
    kind: "package-script",
    packageManager: "npm",
    script: "test:run",
    command: "vitest run",
  },
  testFiles: ["tests/utils/upstreamFetch.test.js"],
  args: [],
  classification: "expected-green",
  minTests: 1,
} as const;

describe("cross-project verification capability", () => {
  it("hashes transitive installed bytes outside the parent thread and excludes disposable Vite caches", async () => {
    const root = consumer("npm");
    const capture = () => captureVerificationEnvironmentIdentity(root, []);
    const before = await capture();
    mkdirSync(path.join(root, "node_modules/.vite"));
    writeFileSync(path.join(root, "node_modules/.vite/cache"), "temporary");
    expect(await capture()).toBe(before);
    writeFileSync(path.join(root, "node_modules/transitive.js"), "changed");
    expect(await capture()).not.toBe(before);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      captureVerificationEnvironmentIdentity(root, [], controller.signal),
    ).rejects.toThrow("cancelled");
  });
  it.each([
    ["launcher", "bin/npm-cli.js"],
    ["launcher", "lib/cli.js"],
    ["launcher", "node_modules/helper/index.js"],
    ["fixed-arg", "bin/npm-cli.js"],
    ["fixed-arg", "lib/cli.js"],
    ["fixed-arg", "node_modules/helper/index.js"],
  ])(
    "invalidates retained identity for a system %s when %s changes",
    async (bindingKind, changedFile) => {
      const root = consumer("npm");
      const system = path.join(root, "system");
      const installed = path.join(system, "lib/node_modules/npm");
      mkdirSync(path.join(system, "bin"), { recursive: true });
      for (const file of [
        "bin/npm-cli.js",
        "lib/cli.js",
        "node_modules/helper/index.js",
      ]) {
        mkdirSync(path.dirname(path.join(installed, file)), {
          recursive: true,
        });
        writeFileSync(path.join(installed, file), "original installed bytes\n");
      }
      writeFileSync(
        path.join(installed, "package.json"),
        JSON.stringify({ name: "npm", bin: { npm: "bin/npm-cli.js" } }),
      );
      const launcher = path.join(system, "bin/npm");
      symlinkSync("../lib/node_modules/npm/bin/npm-cli.js", launcher);
      const binding =
        bindingKind === "launcher"
          ? { command: "npm", executablePath: launcher }
          : {
              command: "npm",
              executablePath: process.execPath,
              fixedArgs: [launcher],
            };
      // System runners have no private mount source to cover their package bytes.
      vi.spyOn(
        verificationCapability,
        "validateVerificationAdapterCapability",
      ).mockReturnValue({
        ok: true,
        verificationId: npmVitest.id,
        runnerBindings: [binding],
      });
      const verification = {
        ...npmVitest,
        testFiles: [...npmVitest.testFiles],
        args: [],
      };
      const paths = verificationRunnerFiles(root, verification, [binding]);
      const bound = verificationEnvironmentDigest(paths);
      const before = await captureVerificationEnvironmentIdentity(root, [
        verification,
      ]);
      writeFileSync(
        path.join(installed, changedFile),
        "upgraded installed bytes\n",
      );
      expect(verificationEnvironmentDigest(paths)).not.toBe(bound);
      expect(
        await captureVerificationEnvironmentIdentity(root, [verification]),
      ).not.toBe(before);
    },
  );

  it("invalidates a bound capability when an installed local runner changes", () => {
    const root = consumer("npm");
    const bound = bindCurrentVerificationCapability(root, {
      kind: "static-check",
      id: "local-check",
      runner: { kind: "local-binary", executable: "tsc" },
      args: [],
      classification: "expected-green",
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) throw new Error("capability unavailable");
    expect(isVerificationCapabilityCurrent(root, bound.value)).toBe(true);
    writeFileSync(
      path.join(root, "node_modules/tsc.js"),
      "#!/usr/bin/env node\nprocess.exit(1);\n",
    );
    expect(isVerificationCapabilityCurrent(root, bound.value)).toBe(false);
  });
  it("resolves Windows PATH runners case-insensitively without POSIX execute bits", () => {
    const root = consumer("npm");
    const fixture = windowsRunnerFixture(root);

    expect(
      resolveVerificationRunner("node", fixture.environment),
    ).toMatchObject({ command: "node", executablePath: fixture.node });
    expect(resolveVerificationRunner("npm", fixture.environment)).toMatchObject(
      {
        command: "npm",
        executablePath: fixture.node,
        fixedArgs: [fixture.npmCli],
      },
    );
    expect(resolveVerificationRunner("npx", fixture.environment)).toMatchObject(
      {
        command: "npx",
        executablePath: fixture.node,
        fixedArgs: [fixture.npxCli],
      },
    );
  });

  it("does not duplicate a Windows drive while finding a common directory", () => {
    expect(
      commonDirectory(
        "C:\\Program Files\\nodejs",
        "c:\\Program Files\\nodejs\\node_modules\\npm",
        "win32",
      ),
    ).toBe("C:\\Program Files\\nodejs");
    expect(
      commonDirectory(
        "C:\\Program Files\\nodejs",
        "D:\\Program Files\\nodejs",
        "win32",
      ),
    ).toBe("C:\\");
  });

  it("rejects missing, directory, and unsupported Windows launcher candidates", () => {
    const root = consumer("npm");
    const runnerDirectory = path.join(root, "invalid-windows-runners");
    mkdirSync(path.join(runnerDirectory, "folder.EXE"), { recursive: true });
    writeFileSync(path.join(runnerDirectory, "script.PS1"), "fixture\n", {
      mode: 0o644,
    });
    writeFileSync(path.join(runnerDirectory, "batch.BAT"), "fixture\n", {
      mode: 0o644,
    });
    const environment = {
      platform: "win32" as const,
      path: runnerDirectory,
      pathExt: ".PS1;.EXE;.CMD",
      pathDelimiter: path.delimiter,
    };

    expect(resolveVerificationRunner("missing", environment)).toBeNull();
    expect(resolveVerificationRunner("folder", environment)).toBeNull();
    expect(resolveVerificationRunner("script.ps1", environment)).toBeNull();
    expect(resolveVerificationRunner("batch", environment)).toBeNull();
  });

  it("keeps POSIX execute-bit enforcement", () => {
    const root = consumer("npm");
    const runnerDirectory = path.join(root, "posix-runners");
    mkdirSync(runnerDirectory);
    const runner = path.join(runnerDirectory, "custom-runner");
    writeFileSync(runner, "#!/bin/sh\n", { mode: 0o644 });
    chmodSync(runner, 0o644);
    const environment = {
      platform: "linux" as const,
      path: runnerDirectory,
      pathExt: "",
      pathDelimiter: path.delimiter,
    };

    expect(resolveVerificationRunner("custom-runner", environment)).toBeNull();
    chmodSync(runner, 0o755);
    expect(
      resolveVerificationRunner("custom-runner", environment),
    ).toMatchObject({ command: "custom-runner", executablePath: runner });

    const localRunner = path.join(root, "node_modules/.bin/local-check");
    writeFileSync(localRunner, "#!/bin/sh\n", { mode: 0o644 });
    chmodSync(localRunner, 0o644);
    const contract = {
      kind: "static-check",
      id: "posix-local-check",
      runner: { kind: "local-binary", executable: "local-check" },
      args: [],
      classification: "expected-green",
    };
    expect(
      validateVerificationAdapterCapability(root, contract, {
        runnerEnvironment: environment,
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "local-executable-missing" },
    });
    chmodSync(localRunner, 0o755);
    expect(
      validateVerificationAdapterCapability(root, contract, {
        runnerEnvironment: environment,
      }),
    ).toMatchObject({ ok: true });
  });

  it("accepts a zero-execute-bit Windows local Vitest and exact package script", () => {
    const root = consumer("npm");
    const fixture = windowsRunnerFixture(root);
    const localBin = path.join(root, "node_modules/.bin/vitest");
    rmSync(localBin);
    writeFileSync(localBin, "#!/bin/sh\n", { mode: 0o644 });
    writeFileSync(`${localBin}.CMD`, "@echo off\r\n", { mode: 0o644 });
    chmodSync(localBin, 0o644);

    expect(
      validateVerificationAdapterCapability(root, npmVitest, {
        runnerEnvironment: fixture.environment,
      }),
    ).toMatchObject({ ok: true, runnerBindings: expect.any(Array) });
  });

  it("binds a Windows local binary to node and its contained package CLI", () => {
    const root = consumer("npm");
    const fixture = windowsRunnerFixture(root);
    const localBin = path.join(root, "node_modules/.bin/vitest");
    rmSync(localBin);
    writeFileSync(localBin, "#!/bin/sh\n", { mode: 0o644 });
    writeFileSync(`${localBin}.cmd`, "@echo off\r\n", { mode: 0o644 });
    const packageRoot = path.join(root, "node_modules/vitest");
    mkdirSync(packageRoot, { recursive: true });
    const cli = path.join(packageRoot, "vitest.mjs");
    writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "vitest", bin: { vitest: "./vitest.mjs" } }),
    );
    writeFileSync(cli, "export {};\n", { mode: 0o644 });

    expect(
      validateVerificationAdapterCapability(
        root,
        {
          kind: "static-check",
          id: "windows-local-vitest",
          runner: { kind: "local-binary", executable: "vitest" },
          args: ["--version"],
          classification: "expected-green",
        },
        { runnerEnvironment: fixture.environment },
      ),
    ).toMatchObject({
      ok: true,
      runnerBindings: [
        {
          command: "vitest",
          executablePath: fixture.node,
          fixedArgs: [cli],
        },
      ],
    });
  });

  it.each(["bun test", "node before.mjs && bun test", "npm run nested"])(
    "retains private runtime mounts and PATH for approved script %s",
    (command) => {
      const root = consumer("npm");
      const runtime = path.join(root, "private-home/.bun/bin");
      mkdirSync(runtime, { recursive: true });
      writeFileSync(path.join(runtime, "bun"), "#!/bin/sh\nexit 0\n", {
        mode: 0o755,
      });
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ scripts: { test: command, nested: "bun test" } }),
      );
      const capability = validateVerificationAdapterCapability(
        root,
        {
          kind: "package-script",
          id: "bun-script",
          packageManager: "npm",
          script: "test",
          command,
          args: [],
          classification: "expected-green",
        },
        {
          runnerEnvironment: {
            path: `${runtime}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        },
      );
      expect(capability.ok).toBe(true);
      if (!capability.ok) throw new Error("capability unavailable");
      expect(capability.runnerBindings).toContainEqual({
        command: "bun",
        executablePath: path.join(runtime, "bun"),
        mountSource: runtime,
      });
      const environment = prepareVerificationEnvironment(
        root,
        root,
        capability.runnerBindings,
      );
      try {
        const mount = environment.mounts.find(
          (entry) => entry.source === runtime,
        );
        expect(mount).toBeDefined();
        expect(environment.environment.PATH.split(":")).toContain(
          mount!.target,
        );
      } finally {
        environment.cleanup();
      }
    },
  );

  it("accepts an approved opaque package script on Windows", () => {
    const root = consumer("npm");
    const fixture = windowsRunnerFixture(root);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { "test:run": "npm exec vitest" } }),
    );

    expect(
      validateVerificationAdapterCapability(
        root,
        {
          kind: "package-script",
          id: "windows-networking-script",
          packageManager: "npm",
          script: "test:run",
          command: "npm exec vitest",
          args: [],
          classification: "expected-green",
        },
        { runnerEnvironment: fixture.environment },
      ),
    ).toMatchObject({
      ok: true,
    });
  });

  it("validates every approved npm consumer contract without check/test:target", () => {
    const root = consumer("npm");
    const contracts = [
      npmVitest,
      {
        kind: "package-script",
        id: "npm-typecheck",
        packageManager: "npm",
        script: "typecheck",
        command: "tsc --noEmit",
        args: [],
        classification: "expected-green",
      },
      {
        kind: "package-script",
        id: "npm-build",
        packageManager: "npm",
        script: "build:web",
        command: "vite build",
        args: [],
        classification: "expected-green",
      },
      {
        kind: "static-check",
        id: "prisma-schema",
        runner: { kind: "npx", executable: "prisma", noInstall: true },
        args: ["validate"],
        classification: "expected-green",
      },
      {
        kind: "static-check",
        id: "agents-static",
        runner: { kind: "node", script: "scripts/check-agents.mjs" },
        args: [],
        classification: "expected-green",
      },
    ];

    for (const contract of contracts) {
      expect(validateVerificationCapability(root, contract)).toMatchObject({
        ok: true,
      });
    }
  });

  it("binds compound package scripts, hooks, lockfiles and optional configuration", () => {
    const root = consumer("npm");
    const command = "node before.mjs && npm run test:run -- --run";
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: {
          verify: command,
          "test:run": "vitest run",
          preverify: "node setup.mjs",
        },
      }),
    );
    const contract = {
      kind: "package-script",
      id: "compound",
      packageManager: "npm",
      script: "verify",
      command,
      args: [],
      classification: "expected-green",
    };
    const draft = { ...contract, command: undefined };
    const compiled = bindDraftVerificationInputs(root, draft);
    expect(draft.command).toBeUndefined();
    expect(compiled).toMatchObject({
      command,
      executionBindings: {
        "package.json": expect.stringMatching(/^[a-f0-9]{64}$/u),
        ".npmrc": null,
      },
    });
    const bound = bindCurrentVerificationCapability(root, compiled);
    expect(bound).toMatchObject({ ok: true });
    if (!bound.ok) return;
    writeFileSync(path.join(root, ".npmrc"), "fund=false\n");
    expect(isVerificationCapabilityCurrent(root, bound.value)).toBe(false);
    expect(validateVerificationCapability(root, compiled)).toMatchObject({
      ok: false,
      diagnostic: { code: "verification-config-mismatch" },
    });
  });

  it("allows only parent-authorized execution input changes and still binds the actual invocation", () => {
    const root = consumer("npm");
    const compiled = bindDraftVerificationInputs(root, npmVitest);
    const manifest = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    );
    manifest.description = "approved metadata change";
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    expect(validateVerificationCapability(root, compiled)).toMatchObject({
      ok: false,
      diagnostic: { code: "verification-config-mismatch" },
    });
    const bound = bindCurrentVerificationCapability(root, compiled, {
      executionWritePaths: ["package.json"],
    });
    expect(bound).toMatchObject({ ok: true });
    if (!bound.ok) return;
    manifest.scripts["test:run"] = "vitest --version";
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    expect(isVerificationCapabilityCurrent(root, bound.value)).toBe(false);
    expect(
      validateVerificationCapability(root, compiled, {
        executionWritePaths: ["package.json"],
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: { code: "script-command-mismatch" },
    });
  });

  it.each([
    ".npmrc",
    ".yarnrc",
    ".yarnrc.yml",
    "bunfig.toml",
    "pnpm-workspace.yaml",
  ])(
    "ignores comments and harmless values in %s while rejecting effective host configuration",
    (file) => {
      const root = consumer("npm");
      const separator = [".yarnrc.yml", "pnpm-workspace.yaml"].includes(file)
        ? ": "
        : "=";
      writeFileSync(
        path.join(root, file),
        `# token password plugins script-shell are documentation\ncache${separator}"./token-cache" # ordinary comment\n`,
      );
      expect(validateVerificationCapability(root, npmVitest)).toMatchObject({
        ok: true,
      });
      writeFileSync(
        path.join(root, file),
        `"script-shell"${separator}"/host/shell"\n`,
      );
      expect(validateVerificationCapability(root, npmVitest)).toMatchObject({
        ok: false,
        diagnostic: { code: "verification-config-unsafe" },
      });
    },
  );

  it("rejects a missing package script", () => {
    const root = consumer("npm");
    const result = validateVerificationCapability(root, {
      ...npmVitest,
      runner: {
        ...npmVitest.runner,
        script: "test:missing",
      },
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { kind: "verification-adapter", code: "script-missing" },
    });
  });

  it("rejects a missing verification input", () => {
    const root = consumer("npm");
    rmSync(path.join(root, "tests/utils/upstreamFetch.test.js"));

    expect(validateVerificationCapability(root, npmVitest)).toMatchObject({
      ok: false,
      diagnostic: { kind: "verification-adapter", code: "input-missing" },
    });
  });

  it("binds exact verification inputs and detects later drift", () => {
    const root = consumer("npm");
    const capability = bindCurrentVerificationCapability(root, npmVitest);
    expect(capability).toMatchObject({ ok: true });
    if (!capability.ok) return;
    expect(isVerificationCapabilityCurrent(root, capability.value)).toBe(true);
    writeFileSync(
      path.join(root, "tests/utils/upstreamFetch.test.js"),
      "changed after capability binding\n",
    );
    expect(isVerificationCapabilityCurrent(root, capability.value)).toBe(false);
  });

  it("classifies unsupported and downloading runners", () => {
    const root = consumer("npm");
    const unsupported = validateVerificationCapability(root, {
      ...npmVitest,
      kind: "shell",
      argv: ["npm", "test"],
    });
    const downloading = validateVerificationCapability(root, {
      ...npmVitest,
      runner: { kind: "npx", executable: "vitest", noInstall: false },
    });

    expect(unsupported).toMatchObject({
      ok: false,
      diagnostic: {
        kind: "design-readiness",
        code: "verification-contract-unsupported",
      },
    });
    expect(downloading).toMatchObject({
      ok: false,
      diagnostic: {
        kind: "design-readiness",
        code: "verification-contract-unsupported",
      },
    });
  });

  it("rejects script drift, shell operators, path symlinks, and escaping local bins", () => {
    const root = consumer("npm");
    const drift = validateVerificationCapability(root, {
      ...npmVitest,
      runner: { ...npmVitest.runner, command: "vitest --run" },
    });
    expect(drift).toMatchObject({
      ok: false,
      diagnostic: {
        kind: "verification-adapter",
        code: "script-command-mismatch",
      },
    });

    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { "test:run": "vitest run && node outside.js" },
      }),
    );
    const unsafe = validateVerificationCapability(root, {
      ...npmVitest,
      runner: {
        ...npmVitest.runner,
        command: "vitest run && node outside.js",
      },
    });
    expect(unsafe).toMatchObject({
      ok: false,
      diagnostic: {
        kind: "design-readiness",
        code: "verification-contract-unsupported",
      },
    });

    rmSync(path.join(root, "tests/utils/upstreamFetch.test.js"));
    symlinkSync(
      path.join(fixtures, "npm/tests/utils/upstreamFetch.test.js"),
      path.join(root, "tests/utils/upstreamFetch.test.js"),
    );
    expect(validateVerificationCapability(root, npmVitest)).toMatchObject({
      ok: false,
      diagnostic: { kind: "verification-adapter", code: "input-missing" },
    });

    const outside = path.join(root, "outside-vitest");
    writeFileSync(outside, "#!/bin/sh\n");
    chmodSync(outside, 0o755);
    rmSync(path.join(root, "node_modules/.bin/vitest"));
    symlinkSync(outside, path.join(root, "node_modules/.bin/vitest"));
    expect(
      validateVerificationCapability(root, {
        kind: "static-check",
        id: "local-vitest",
        runner: { kind: "local-binary", executable: "vitest" },
        args: ["--version"],
        classification: "expected-green",
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        kind: "verification-adapter",
        code: "local-executable-missing",
      },
    });
  });
});
