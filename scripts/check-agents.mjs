#!/usr/bin/env node
// AGENTS index validation: every indexed path and command must exist and the
// managed block must not index runtime IDs, timestamps, approval state,
// version policy, or a reference-repository product dependency. Managed project
// knowledge in .cadence/project.md and .cadence/knowledge/*.md must stay within
// budget with valid routes, headings, source anchors and links.
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
  "docs/",
  ".cadence/project.md",
  ".cadence/knowledge/",
]) {
  if (!block.includes(`\`${route}\``))
    throw new Error(`AGENTS index missing project ownership route: ${route}`);
}
if (/openspec|prompts\//iu.test(block))
  throw new Error("AGENTS index retains retired ownership");

const KNOWLEDGE_BUDGET = {
  indexBytes: 4096,
  topicBytes: 8192,
  entryBytes: 1024,
  totalBytes: 204800,
  topicFiles: 64,
};
const projectIndexPath = join(ROOT, ".cadence/project.md");
if (!existsSync(projectIndexPath))
  throw new Error(".cadence/project.md is missing");
const projectIndex = readFileSync(projectIndexPath, "utf8");
const indexBytes = Buffer.byteLength(projectIndex, "utf8");
if (indexBytes > KNOWLEDGE_BUDGET.indexBytes) {
  throw new Error(
    `.cadence/project.md exceeds ${KNOWLEDGE_BUDGET.indexBytes} bytes (${indexBytes})`,
  );
}
const hasHeading = (text, heading) =>
  text
    .split("\n")
    .some(
      (line) =>
        /^#{1,6}\s+/u.test(line) &&
        line.replace(/^#{1,6}\s+/u, "").trim() === heading,
    );
const routeLines = (
  projectIndex.split("\n## Routes\n")[1]?.split("\n## ")[0] ?? ""
)
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("- "));
if (routeLines.length === 0)
  throw new Error(".cadence/project.md lacks routes under ## Routes");
const routedTargets = new Set();
for (const line of routeLines) {
  const match = /^-\s+(.+?)\s*->\s*`([^`]+)`\s*(?:—|--|-)\s*(.+)$/u.exec(line);
  if (!match)
    throw new Error(`.cadence/project.md has unparsed route: ${line}`);
  const [, sources, target] = match;
  for (const [, src] of sources.matchAll(/`([^`]+)`/gu)) {
    if (!existsSync(resolve(ROOT, src)))
      throw new Error(
        `.cadence/project.md route names a missing source path: ${src}`,
      );
  }
  const [relPath, heading] = target.split("#");
  const absTarget = resolve(ROOT, relPath);
  if (!existsSync(absTarget))
    throw new Error(
      `.cadence/project.md route targets a missing file: ${relPath}`,
    );
  if (heading && !hasHeading(readFileSync(absTarget, "utf8"), heading)) {
    throw new Error(
      `.cadence/project.md route targets a missing heading: ${target}`,
    );
  }
  routedTargets.add(relPath);
}

const knowledgeDir = join(ROOT, ".cadence/knowledge");
const topicFiles = existsSync(knowledgeDir)
  ? readdirSync(knowledgeDir)
      .filter((name) => name.endsWith(".md"))
      .sort()
  : [];
if (topicFiles.length === 0)
  throw new Error(".cadence/knowledge/ has no topic cards");
if (topicFiles.length > KNOWLEDGE_BUDGET.topicFiles) {
  throw new Error(
    `.cadence/knowledge/ exceeds ${KNOWLEDGE_BUDGET.topicFiles} files (${topicFiles.length})`,
  );
}
let totalKnowledgeBytes = indexBytes;
for (const name of topicFiles) {
  const relCard = `.cadence/knowledge/${name}`;
  if (!routedTargets.has(relCard)) {
    throw new Error(`${relCard} is not routed from .cadence/project.md`);
  }
  const card = readFileSync(join(knowledgeDir, name), "utf8");
  const cardBytes = Buffer.byteLength(card, "utf8");
  totalKnowledgeBytes += cardBytes;
  if (cardBytes > KNOWLEDGE_BUDGET.topicBytes) {
    throw new Error(
      `${relCard} exceeds ${KNOWLEDGE_BUDGET.topicBytes} bytes (${cardBytes})`,
    );
  }
  const entries = card.split(/(?=^### )/gmu).slice(1);
  if (entries.length === 0)
    throw new Error(`${relCard} has no ### knowledge entries`);
  const seenTitles = new Set();
  for (const rawEntry of entries) {
    const entry = rawEntry.split(/\n## /u)[0];
    const title = entry
      .split("\n")[0]
      .replace(/^###\s+/u, "")
      .trim();
    const key = title.toLowerCase();
    if (seenTitles.has(key))
      throw new Error(`${relCard} has duplicate entry title: ${title}`);
    seenTitles.add(key);
    const entryBytes = Buffer.byteLength(entry, "utf8");
    if (entryBytes > KNOWLEDGE_BUDGET.entryBytes) {
      throw new Error(
        `${relCard}#${title} exceeds ${KNOWLEDGE_BUDGET.entryBytes} bytes (${entryBytes})`,
      );
    }
    const anchorLine = entry
      .split("\n")
      .find((line) => line.startsWith("Anchors:"));
    if (!anchorLine)
      throw new Error(`${relCard}#${title} is missing an Anchors: line`);
    const anchors = [...anchorLine.matchAll(/`([^`]+)`/gu)].map((m) => m[1]);
    if (anchors.length === 0)
      throw new Error(`${relCard}#${title} has no anchored repository paths`);
    for (const anchor of anchors) {
      const hashIdx = anchor.indexOf("#");
      const rel = hashIdx === -1 ? anchor : anchor.slice(0, hashIdx);
      const sym = hashIdx === -1 ? "" : anchor.slice(hashIdx + 1);
      const abs = resolve(ROOT, rel);
      if (!existsSync(abs))
        throw new Error(`${relCard}#${title} anchors a missing path: ${rel}`);
      if (sym && !readFileSync(abs, "utf8").includes(sym)) {
        throw new Error(
          `${relCard}#${title} anchors a missing symbol: ${anchor}`,
        );
      }
    }
  }
  for (const [, target] of card.matchAll(/\]\(([^)#\s]+)[^)]*\)/gu)) {
    if (/^[a-z]+:/u.test(target)) continue;
    if (!existsSync(resolve(knowledgeDir, target)))
      throw new Error(`${relCard} links to a missing file: ${target}`);
  }
}
if (totalKnowledgeBytes > KNOWLEDGE_BUDGET.totalBytes) {
  throw new Error(
    `.cadence knowledge store exceeds ${KNOWLEDGE_BUDGET.totalBytes} bytes (${totalKnowledgeBytes})`,
  );
}
const provenance = readFileSync(
  join(ROOT, "provenance/adapted-modules.yaml"),
  "utf8",
);
for (const role of [
  "design-explorer",
  "diagnosis-worker",
  "implementation-worker",
  "route-planner",
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
console.log("check:agents: AGENTS index and project knowledge routes valid");
