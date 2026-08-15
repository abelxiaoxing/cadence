#!/usr/bin/env node
// AGENTS index validation: every indexed path and command must exist and the
// managed block must not index runtime IDs, timestamps, approval state,
// version policy, or a reference-repository product dependency.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
  [/runtime (id|state)|session (id|state)|ledger/i, "runtime state"],
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
  if (route.includes("(") || route.startsWith("@")) continue; // function/API or package-name route
  if (/\s/.test(route)) {
    // command phrase: the first token must be on PATH
    const token = route.split(/\s+/)[0];
    const onPath = (process.env.PATH ?? "")
      .split(":")
      .some((dir) => dir && existsSync(join(dir, token)));
    if (!onPath) throw new Error(`indexed command not on PATH: ${token}`);
    continue;
  }
  const candidate = resolve(ROOT, route);
  if (!existsSync(candidate)) {
    throw new Error(`indexed path does not exist: ${route}`);
  }
  if (statSync(candidate).isSymbolicLink()) {
    throw new Error(`indexed path must not be a symlink: ${route}`);
  }
}

console.log("check:agents: AGENTS index valid");
