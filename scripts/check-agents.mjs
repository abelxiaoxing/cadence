#!/usr/bin/env node
// AGENTS index validation: every indexed path and command must exist and the
// managed block must not index runtime IDs, timestamps, approval state,
// version policy, or a reference-repository product dependency. Every
// engineering/ area file must be indexed, and the repository paths, relative
// links and regression owners it names must still exist.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentsPath = join(ROOT, "AGENTS.md");
const agents = readFileSync(agentsPath, "utf8");

const start = agents.indexOf("<!-- ABEL:AGENTS-INDEX:START -->");
const end = agents.indexOf("<!-- ABEL:AGENTS-INDEX:END -->");
if (start === -1 || end === -1 || end < start) {
  throw new Error("managed AGENTS index block is missing or malformed");
}
const count = (needle) => agents.split(needle).length - 1;
if (
  count("<!-- ABEL:AGENTS-INDEX:START -->") !== 1 ||
  count("<!-- ABEL:AGENTS-INDEX:END -->") !== 1
) {
  throw new Error("expected exactly one managed marker pair");
}

const block = agents.slice(start, end);
const FORBIDDEN = [
  [/[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}:[0-9]{2}:[0-9]{2}/, "timestamps"],
  [
    /\b(compatib|unsupported version|version (range|policy|support))\b/i,
    "version policy",
  ],
  [
    /gate[- ](a|b)[^\n]*(approved|pending|granted)|approval (state|status)|\breceipt\b[^\n]*(sha256|status)/i,
    "Gate/approval state",
  ],
  [
    /runtime (?:id|state value)|session (?:id|state value)|dirty-state (?:ledger|record)|run-state value/i,
    "runtime state",
  ],
  [/@gotgenes|pi-subagents/i, "reference package dependency"],
  [/pi-packages/i, "reference repository route"],
];
const lines = block.split("\n");
for (const [pattern, what] of FORBIDDEN) {
  if (
    what === "reference repository route" &&
    lines.some((l) => /evidence|read-only|provenance/i.test(l))
  ) {
    continue; // evidence-only reference mention is not a product route
  }
  if (pattern.test(block))
    throw new Error(`managed index must not contain ${what}`);
}

// Every `path`-style backticked route must exist (file, directory, or command).
const routes = [...block.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
for (const route of routes) {
  if (route.startsWith("/") || route.includes("..")) {
    throw new Error(`route must stay inside the repository: ${route}`);
  }
  if (
    route.includes("(") ||
    route.startsWith("@") ||
    /^[A-Z][A-Za-z0-9]*$/u.test(route)
  )
    continue; // function/type/API or package-name route
  if (/\s/.test(route)) {
    // command phrase: the first token must be on PATH
    const token = route.split(/\s+/)[0];
    const onPath = (process.env.PATH ?? "")
      .split(delimiter)
      .some((dir) => dir && existsSync(join(dir, token)));
    if (!onPath) throw new Error(`indexed command not on PATH: ${token}`);
    continue;
  }
  const candidate = resolve(ROOT, route);
  if (!existsSync(candidate)) {
    throw new Error(`indexed path does not exist: ${route}`);
  }
  if (lstatSync(candidate).isSymbolicLink()) {
    throw new Error(`indexed path must not be a symlink: ${route}`);
  }
}

for (const route of [
  "package.json",
  "src/index.ts",
  "README.md",
  "src/service/",
  "src/history/",
  "web/src/",
]) {
  if (!block.includes(`\`${route}\``))
    throw new Error("AGENTS index missing project ownership route");
}
if (/openspec|prompts\//iu.test(block))
  throw new Error("AGENTS index retains retired ownership");

const ENGINEERING = join(ROOT, "engineering");
const REPO_PATH =
  /^(?:agents|config|docs|engineering|licenses|provenance|scripts|skills|src|test|web)\//u;
const expandBraces = (route) => {
  const group = /\{([^{}]+)\}/u.exec(route);
  if (!group) return [route];
  const [before, after] = [
    route.slice(0, group.index),
    route.slice(group.index + group[0].length),
  ];
  return group[1]
    .split(",")
    .flatMap((part) => expandBraces(before + part + after));
};
const testNames = [];
const walkTests = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walkTests(join(dir, entry.name));
    else testNames.push(entry.name);
  }
};
walkTests(join(ROOT, "test"));
for (const name of readdirSync(ENGINEERING).filter((n) => n.endsWith(".md"))) {
  if (!block.includes(`\`engineering/${name}\``))
    throw new Error(`AGENTS index missing engineering/${name}`);
  // Release evidence is an append-only log: it may name paths that later go away.
  if (name === "releases.md") continue;
  const doc = readFileSync(join(ENGINEERING, name), "utf8");
  for (const [, route] of doc.matchAll(/`([^`\s]+)`/gu)) {
    if (!REPO_PATH.test(route) || /[<*]/u.test(route)) continue;
    for (const path of expandBraces(route))
      if (!existsSync(join(ROOT, path)))
        throw new Error(`engineering/${name} names a missing path: ${path}`);
  }
  for (const [, target] of doc.matchAll(/\]\(([^)#\s]+)[^)]*\)/gu)) {
    if (/^[a-z]+:/u.test(target)) continue;
    if (!existsSync(resolve(ENGINEERING, target)))
      throw new Error(`engineering/${name} links to a missing file: ${target}`);
  }
}
const owners = readFileSync(join(ENGINEERING, "verification.md"), "utf8")
  .split("\n## Regression owners\n")[1]
  ?.split("\n## ")[0];
if (!owners)
  throw new Error("engineering/verification.md lacks Regression owners");
for (const line of owners.split("\n").filter((l) => l.startsWith("- "))) {
  for (const [, stem] of line.split(": ")[0].matchAll(/`([^`]+)`/gu)) {
    if (stem.includes("/")) continue; // a directory, checked as a path above
    const found = stem.endsWith("*")
      ? testNames.some((n) => n.startsWith(stem.slice(0, -1)))
      : testNames.some((n) => n.startsWith(`${stem}.`));
    if (!found) throw new Error(`regression owner has no test file: ${stem}`);
  }
}
const provenance = readFileSync(
  join(ROOT, "provenance/adapted-modules.yaml"),
  "utf8",
);
for (const role of [
  "design-explorer",
  "diagnosis-worker",
  "implementation-worker",
]) {
  const hash = createHash("sha256")
    .update(readFileSync(join(ROOT, "agents", `${role}.md`)))
    .digest("hex");
  const binding = provenance.match(
    new RegExp(
      `path: agents/${role}\\.md[\\s\\S]{0,160}?role: ${role}[\\s\\S]{0,160}?sha256: ([0-9a-f]{64})`,
      "u",
    ),
  );
  if (binding?.[1] !== hash) throw new Error("Agent provenance drift");
}
console.log("check:agents: AGENTS index and engineering routes valid");
