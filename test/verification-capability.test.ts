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
import { validateVerificationCapability } from "../src/verification-capability.ts";

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
