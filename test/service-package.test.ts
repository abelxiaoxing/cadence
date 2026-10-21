import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { auditNotices } from "../scripts/audit-notices.mjs";

const root = resolve(import.meta.dirname, "..");
const members: string[] = JSON.parse(
  readFileSync(join(root, "provenance/package-members.json"), "utf8"),
);
it("reviewed package closes native and maintained worker imports without a terminal executor or bundled SDK", () => {
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
    "src/install-config.mjs",
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
it("verify includes actual browser once, separate web tests, Agent checks and real pack; no consumer build", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const route of [
    "check:web",
    "build:web:check",
    "check:agents",
    "test:web",
    "test:browser",
    "pack:check",
  ])
    expect(pkg.scripts.verify).toContain(`bun run ${route}`);
  expect(pkg.scripts.verify.match(/bun run test:browser/g)).toHaveLength(1);
  expect(pkg.scripts.postinstall).toBe("node src/install-config.mjs");
  expect(readFileSync(join(root, "vitest.config.ts"), "utf8")).not.toContain(
    "e2e",
  );
  expect(readFileSync(join(root, "web/browser.config.ts"), "utf8")).toContain(
    "test/web/*.e2e.mjs",
  );
});
