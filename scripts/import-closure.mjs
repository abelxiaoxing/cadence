// Relative runtime imports of the modules a package ships, never shipped itself.
import path from "node:path";
import ts from "typescript";

// Browser assets under web/ are checked by the web build, declarations never load.
const loaded = (name) =>
  /\.[cm]?[jt]s$/u.test(name) &&
  !/\.d\.[cm]?ts$/u.test(name) &&
  !name.startsWith("package/web/");

/** Relative specifiers a module loads at runtime; type-only imports are erased. */
export function runtimeImports(name, text) {
  const specifiers = [];
  const add = (node) => {
    if (node && ts.isStringLiteral(node) && node.text.startsWith("."))
      specifiers.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const erased =
        clause?.isTypeOnly ||
        (named &&
          ts.isNamedImports(named) &&
          !clause.name &&
          named.elements.every((element) => element.isTypeOnly));
      if (!erased) add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly) add(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    )
      add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(name, text, ts.ScriptTarget.Latest));
  return specifiers;
}

/** Refuse archive bodies whose modules import a relative path the archive lacks:
 * the source tree resolves it, an installed package fails at load. */
export function assertImportClosure(bodies) {
  const missing = [];
  for (const [name, bytes] of bodies) {
    if (!loaded(name)) continue;
    for (const specifier of runtimeImports(name, bytes.toString("utf8"))) {
      if (!bodies.has(path.posix.join(path.posix.dirname(name), specifier)))
        missing.push(`${name.slice(8)} -> ${specifier}`);
    }
  }
  if (missing.length)
    throw new Error(`package-import-missing:\n  ${missing.join("\n  ")}`);
}
