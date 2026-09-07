import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const sourceRoot = path.resolve(import.meta.dirname, "../src");
it("keeps child execution independent of Pi sessions and parent callback capture", () => {
  const child = readFileSync(path.join(sourceRoot, "child-session.ts"), "utf8");
  expect(child).not.toMatch(
    /createAgentSession|SessionManager|SettingsManager|shouldStopAfterTurn|session\.agent|session\.subscribe/,
  );
  const parent = readFileSync(
    path.join(sourceRoot, "parent-provider.ts"),
    "utf8",
  );
  expect(parent).not.toMatch(
    /ParentPayloadBridge|capture\(|getRegisteredNativeProvider|ModelRuntime|registerNativeProvider|onPayload|new Proxy/,
  );
  for (const file of readdirSync(sourceRoot).filter((name) =>
    name.endsWith(".ts"),
  )) {
    expect(readFileSync(path.join(sourceRoot, file), "utf8"), file).not.toMatch(
      /from ["'][^"']*dist\/core\//,
    );
  }
  for (const file of readdirSync(path.resolve(sourceRoot, "../test")).filter(
    (name) => /\.(ts|mjs)$/.test(name),
  )) {
    expect(
      readFileSync(path.resolve(sourceRoot, "../test", file), "utf8"),
      file,
    ).not.toMatch(/from ["'][^"']*dist\/core\//);
  }
  const modelAdapter = readFileSync(
    path.join(sourceRoot, "child-model.ts"),
    "utf8",
  );
  expect(modelAdapter).not.toContain("@earendil-works/pi-coding-agent");
  expect(modelAdapter).not.toContain("@earendil-works/pi-agent-core");
});
function imports() {
  const graph = new Map<string, string[]>();
  for (const file of readdirSync(sourceRoot).filter((name) =>
    /\.(ts|mjs)$/.test(name),
  )) {
    const ast = ts.createSourceFile(
      file,
      readFileSync(path.join(sourceRoot, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const dependencies: string[] = [];
    for (const statement of ast.statements) {
      if (
        (!ts.isImportDeclaration(statement) &&
          !ts.isExportDeclaration(statement)) ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const specifier = statement.moduleSpecifier.text;
      if (specifier.startsWith("./")) dependencies.push(specifier.slice(2));
    }
    graph.set(file, dependencies);
  }
  return graph;
}

it("keeps local module dependencies acyclic, including type dependencies", () => {
  const graph = imports();
  const visited = new Set<string>();
  const visit = (file: string, ancestors: string[]) => {
    expect(
      ancestors,
      `module cycle: ${[...ancestors, file].join(" -> ")}`,
    ).not.toContain(file);
    if (visited.has(file)) return;
    for (const dependency of graph.get(file) ?? [])
      visit(dependency, [...ancestors, file]);
    visited.add(file);
  };
  for (const file of graph.keys()) visit(file, []);
});

it("keeps host adapters and workflow transition authority out of execution policy and child sessions", () => {
  const graph = imports();
  const reachable = (file: string, result = new Set<string>()): Set<string> => {
    for (const dependency of graph.get(file) ?? []) {
      if (result.has(dependency)) continue;
      result.add(dependency);
      reachable(dependency, result);
    }
    return result;
  };
  for (const entry of [
    "child-session.ts",
    "packet-runtime.ts",
    "workflow-policy.ts",
    "workflow-status.ts",
    "candidate-artifact.ts",
    "package-verification.ts",
  ]) {
    expect([...reachable(entry)], entry).not.toEqual(
      expect.arrayContaining(["workflow-state-machine.ts"]),
    );
    expect([...reachable(entry)], entry).not.toContain("index.ts");
  }
  for (const entry of ["child-session.ts", "packet-runtime.ts"]) {
    expect([...reachable(entry)], entry).not.toContain("apply-transaction.ts");
    expect([...reachable(entry)], entry).not.toContain("run-store.ts");
  }
});
