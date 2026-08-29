import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  bindCurrentVerificationCapability,
  commonDirectory,
  isVerificationCapabilityCurrent,
  resolveVerificationRunner,
  validateVerificationAdapterCapability,
  validateVerificationCapability,
} from "../src/verification-capability.ts";

const fixtures = fileURLToPath(
  new URL("./fixtures/verification-consumers", import.meta.url),
);
const roots: string[] = [];

afterEach(() => {
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

  it("keeps unsafe and networking package scripts rejected on Windows", () => {
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
      ok: false,
      diagnostic: { code: "script-unsafe" },
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

  it.each([
    "bun x prisma validate",
    "bun --bun x prisma validate",
    "bunx prisma validate",
    "npm exec prisma validate",
    "npm --yes exec prisma validate",
    "pnpm dlx prisma validate",
    "pnpx prisma validate",
    "yarn dlx prisma validate",
  ])("rejects implicit-download package script alias %s", (command) => {
    const root = consumer("bun");
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { schema: command } }),
    );

    expect(
      validateVerificationCapability(root, {
        kind: "package-script",
        id: "download-alias",
        packageManager: "bun",
        script: "schema",
        command,
        args: [],
        classification: "expected-green",
      }),
    ).toMatchObject({
      ok: false,
      diagnostic: {
        kind: "verification-adapter",
        code: "script-unsafe",
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
