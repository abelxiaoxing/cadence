import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { auditNotices } from "../scripts/audit-notices.mjs";

const root = resolve(import.meta.dirname, "..");
const members: string[] = JSON.parse(
  readFileSync(join(root, "provenance/package-members.json"), "utf8"),
);
it("reviewed package closes native and maintained worker imports without a terminal executor or bundled SDK", {
  tags: ["slow"],
}, () => {
  const visited = new Set<string>();
  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    expect(members).toContain(`package/${name}`);
    const source = ts.createSourceFile(
      name,
      readFileSync(join(root, name), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const next = (specifier: string) => {
      if (!specifier.startsWith(".")) return;
      // Reviewed members use "/"; Windows resolves with "\\".
      const path = relative(root, resolve(root, dirname(name), specifier));
      expect(path && !path.startsWith("..") && !isAbsolute(path)).toBe(true);
      visit(path.split(sep).join("/"));
    };
    source.forEachChild((node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        if (node.importClause?.isTypeOnly) return;
        const bindings = node.importClause?.namedBindings;
        if (
          bindings &&
          ts.isNamedImports(bindings) &&
          !node.importClause?.name &&
          bindings.elements.every((e) => e.isTypeOnly)
        )
          return;
        next(node.moduleSpecifier.text);
      } else if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        next(node.moduleSpecifier.text);
    });
    function walk(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        next(node.arguments[0].text);
      ts.forEachChild(node, walk);
    }
    walk(source);
  }
  for (const entry of [
    "src/index.ts",
    "src/sdk-worker.mjs",
    "src/session-rename.mjs",
    "src/cadence-service.mjs",
  ])
    visit(entry);
  expect(visited.has("src/task-controller.ts")).toBe(false);
  expect(members).not.toContain("package/src/task-controller.ts");
  expect(members.some((p) => p.includes("node_modules"))).toBe(false);
  for (const executable of ["operator-cli", "service-cli", "service-host"]) {
    const body = readFileSync(join(root, `src/${executable}.mjs`), "utf8");
    expect(body).not.toMatch(/(?:from|import\()\s*["'][^"']+\.ts["']/);
  }
});
it("current execution and emitted owner have no retired task engine", () => {
  const body = readFileSync(join(root, "src/service-host.mjs"), "utf8");
  for (const name of [
    "TaskActions",
    "ActionAdmission",
    "TaskScheduler",
    "TaskController",
  ])
    expect(body).not.toContain(name);
  for (const name of [
    "workflows",
    "conversations",
    "workbench",
    "model-choice",
  ]) {
    const source = readFileSync(join(root, `src/service/${name}.ts`), "utf8");
    expect(source).not.toMatch(
      /(?:task-actions|scheduler|history\/writer)\.ts/,
    );
  }
  const coordination = readFileSync(
    join(root, "src/service/coordination.ts"),
    "utf8",
  );
  expect(coordination).not.toContain("task-store.ts");
});
it("full emitted dependency, embedded vendor, font and notice policy is exact, not a root MIT assertion", () => {
  expect(auditNotices(root)).toMatchObject({
    families: 105,
    notices: 129,
    fonts: 60,
  });
  expect(() => auditNotices(root, [])).toThrow("bundled-notice-drift");
  const notices = readFileSync(join(root, "licenses/bundled-web.txt"), "utf8");
  for (const text of [
    "SIL OPEN FONT LICENSE",
    "Reserved Font Name KaTeX",
    "Feather",
    "Apache License",
    "Redistribution and use",
  ])
    expect(notices).toContain(text);
});
it("reuse provenance pins every current adaptation and integration body, including builders and tests", () => {
  const policy = JSON.parse(
    readFileSync(join(root, "provenance/webui-reuse.json"), "utf8"),
  );
  for (const [name, expected] of Object.entries(policy.destinations)) {
    const actual = createHash("sha256")
      .update(readFileSync(join(root, name)))
      .digest("hex");
    expect(actual, name).toBe(expected);
  }
  for (const group of policy.groups) {
    for (const name of group.destinations)
      expect(Object.hasOwn(policy.destinations, name), name).toBe(true);
    for (const name of group.sources)
      expect(policy.sources[name], name).toMatch(/^[0-9a-f]{64}$/);
  }
  for (const name of policy.newIntegrationFiles)
    expect(Object.hasOwn(policy.destinations, name), name).toBe(true);
});
it("one fast development/release gate keeps static, unit, web and real-pack checks without a browser or full lane", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  expect(pkg.scripts.verify).toBe("node scripts/verify.mjs");
  for (const retired of [
    "verify:full",
    "test:slow",
    "test:browser",
    "test:web:assets-browser",
  ])
    expect(pkg.scripts[retired]).toBeUndefined();
  for (const command of ["test", "test:target", "test:service"])
    expect(pkg.scripts[command]).toContain("--tags-filter=!slow");
  const verify = readFileSync(join(root, "scripts/verify.mjs"), "utf8");
  for (const stage of [
    '"scripts/check-syntax.mjs"',
    '"scripts/build-operator.mjs", "--check"',
    '"scripts/build-service.mjs", "--check"',
    'tsc("root", "--noEmit")',
    '"web/tsconfig.json"',
    '"scripts/build-web.mjs", "--check"',
    '[bin("biome"), "check", "."]',
    '[bin("rumdl"), "check", "."]',
    '"scripts/check-agents.mjs"',
    '"--tags-filter=!slow"',
    '"web/vitest.config.ts"',
    '"scripts/pack-check.mjs"',
  ])
    expect(verify).toContain(stage);
  expect(verify).toContain("Promise.all(gate.map(stage))");
  expect(verify).not.toMatch(/--full|--tags-filter=slow|browser\.config/);
  expect(pkg.devDependencies["playwright-core"]).toBeUndefined();
  expect(existsSync(join(root, "web/browser.config.ts"))).toBe(false);
  expect(
    readdirSync(join(root, "test/web")).filter((name) =>
      name.endsWith(".e2e.mjs"),
    ),
  ).toEqual([]);
  // npm 12 and Bun skip dependency install scripts by default; none ship.
  for (const hook of ["preinstall", "install", "postinstall", "prepare"])
    expect(pkg.scripts[hook]).toBeUndefined();
});
