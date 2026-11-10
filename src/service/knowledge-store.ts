/** The managed project knowledge store: one route table and topic cards under a
 * fixed budget. This module reads, measures and lints; it never writes. The
 * store is a bounded cache of what cannot be cheaply re-derived from the code:
 * new knowledge has to displace or compress old knowledge, and a delivery
 * whose store is over budget does not pass. */
import { lstatSync, opendirSync, readFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { workflowCovers } from "./contracts/workflow.ts";
import { readKnowledgeFile } from "./project-knowledge.ts";
import { safeWorkflowFile } from "./workflow-git.ts";

export const KNOWLEDGE_STORE = {
  /** Routes code areas to the documents and sections that own them. Every
   * worker and the coordinator receive it whole. */
  index: ".cadence/project.md",
  topics: ".cadence/knowledge",
  indexBytes: 4 * 1024,
  topicBytes: 8 * 1024,
  entryBytes: 1024,
  totalBytes: 200 * 1024,
  topicFiles: 64,
} as const;
/** Paths a delivery may always maintain: the store itself. */
export const KNOWLEDGE_SCOPE: readonly string[] = [
  KNOWLEDGE_STORE.index,
  KNOWLEDGE_STORE.topics,
];

export interface KnowledgeRoute {
  /** Code paths this route is for; a path covers itself and what is under it. */
  patterns: string[];
  /** The document to read first, and one of its headings when named. */
  target: string;
  section: string | null;
  summary: string;
}
export interface KnowledgeAnchor {
  path: string;
  /** Text that must occur in the file: a symbol or a test name. */
  symbol: string | null;
}
export interface KnowledgeEntry {
  topic: string;
  section: string | null;
  title: string;
  bytes: number;
  anchors: KnowledgeAnchor[];
}
export interface KnowledgeTopic {
  path: string;
  bytes: number;
  entries: KnowledgeEntry[];
}
export interface KnowledgeStore {
  index: { bytes: number; routes: KnowledgeRoute[]; unparsed: string[] } | null;
  topics: KnowledgeTopic[];
  totalBytes: number;
  /** More topic files exist than one observation reads. */
  limited: boolean;
}
export interface KnowledgeFinding {
  kind:
    | "over-budget"
    | "dead-route"
    | "dead-anchor"
    | "unanchored"
    | "duplicate"
    | "unparsed-route";
  path: string;
  detail: string;
  /** Whether it fails the delivery, or is only handed to the curator and review. */
  blocking: boolean;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/u;
const quoted = (text: string) =>
  [...text.matchAll(/`([^`]+)`/gu)].map((match) => match[1].trim());
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/gu, "");
const fenced = (line: string) => /^\s*(?:```|~~~)/u.test(line);

/** One section of a Markdown body: from the heading named `heading` (by its
 * text or its slug) to the next heading of the same or a higher level. */
export function knowledgeSection(body: string, heading: string): string | null {
  const lines = body.split("\n"),
    wanted = slug(heading);
  let start = -1,
    level = 0,
    code = false;
  for (let i = 0; i < lines.length; i++) {
    if (fenced(lines[i])) code = !code;
    if (code) continue;
    const match = HEADING.exec(lines[i]);
    if (!match) continue;
    if (start < 0) {
      if (slug(match[2]) === wanted) {
        start = i;
        level = match[1].length;
      }
    } else if (match[1].length <= level)
      return lines.slice(start, i).join("\n").trimEnd();
  }
  return start < 0 ? null : lines.slice(start).join("\n").trimEnd();
}
/** Route lines of the table's `## Routes` section:
 * ``- `src/area`, `test/area` -> `docs/topic.md#Heading` — what it settles``. */
export function knowledgeRoutes(body: string): {
  routes: KnowledgeRoute[];
  unparsed: string[];
} {
  const section = knowledgeSection(body, "Routes");
  const routes: KnowledgeRoute[] = [],
    unparsed: string[] = [];
  for (const line of (section ?? "").split("\n").slice(1)) {
    if (!/^\s*[-*]\s+/u.test(line)) continue;
    const arrow =
      /^\s*[-*]\s+(.+?)\s*(?:->|→)\s*`([^`#\s]+)(?:#([^`]+))?`\s*(?:(?:—|–|:|-)\s*(.*))?$/u.exec(
        line,
      );
    const patterns = arrow ? quoted(arrow[1]) : [];
    if (!arrow || !patterns.length) {
      unparsed.push(line.trim().slice(0, 160));
      continue;
    }
    routes.push({
      patterns: patterns.map((p) => p.replace(/\/\*{1,2}$/u, "")),
      target: posix.normalize(arrow[2]),
      section: arrow[3]?.trim() || null,
      summary: (arrow[4] ?? "").trim(),
    });
  }
  return { routes, unparsed };
}
/** Routes whose code area an assignment's write paths touch, in table order. */
export function matchKnowledgeRoutes(
  routes: readonly KnowledgeRoute[],
  writes: readonly string[],
): KnowledgeRoute[] {
  return routes.filter((route) =>
    route.patterns.some(
      (pattern) =>
        workflowCovers([pattern], pattern) &&
        writes.some(
          (path) =>
            workflowCovers([pattern], path) || workflowCovers([path], pattern),
        ),
    ),
  );
}
/** A topic's entries: each `###` heading with its lines, and the anchors its
 * `Anchors:` line names (`` `path` `` or `` `path#symbol` ``). */
export function knowledgeEntries(
  topic: string,
  body: string,
): KnowledgeEntry[] {
  const lines = body.split("\n");
  const entries: KnowledgeEntry[] = [];
  let section: string | null = null,
    current: { title: string; start: number } | undefined,
    code = false;
  const close = (end: number) => {
    if (!current) return;
    const text = lines.slice(current.start, end).join("\n");
    const anchors = text
      .split("\n")
      .filter((line) => /^\s*Anchors?\s*:/iu.test(line))
      .flatMap(quoted)
      .map((value): KnowledgeAnchor => {
        const at = value.indexOf("#");
        return at < 0
          ? { path: posix.normalize(value), symbol: null }
          : {
              path: posix.normalize(value.slice(0, at)),
              symbol: value.slice(at + 1).trim() || null,
            };
      });
    entries.push({
      topic,
      section,
      title: current.title,
      bytes: Buffer.byteLength(text),
      anchors,
    });
    current = undefined;
  };
  for (let i = 0; i < lines.length; i++) {
    if (fenced(lines[i])) code = !code;
    if (code) continue;
    const match = HEADING.exec(lines[i]);
    if (!match) continue;
    if (match[1].length <= 3) close(i);
    if (match[1].length === 2) section = match[2];
    if (match[1].length === 3) current = { title: match[2], start: i };
  }
  close(lines.length);
  return entries;
}
/** A fresh observation of the store. Unreadable or unsafe files are absent. */
export function readKnowledgeStore(root: string): KnowledgeStore {
  const table = readKnowledgeFile(root, KNOWLEDGE_STORE.index);
  const topics: KnowledgeTopic[] = [];
  let limited = false;
  let names: string[] = [];
  try {
    // Validates every ancestor; the probe names a file inside the directory.
    const directory = dirname(
      safeWorkflowFile(root, `${KNOWLEDGE_STORE.topics}/index.md`),
    );
    if (lstatSync(directory).isDirectory()) {
      const dir = opendirSync(directory);
      try {
        for (let e = dir.readSync(); e; e = dir.readSync()) {
          if (!e.isFile() || !/\.md$/iu.test(e.name)) continue;
          if (names.length >= KNOWLEDGE_STORE.topicFiles) {
            limited = true;
            break;
          }
          names.push(e.name);
        }
      } finally {
        dir.closeSync();
      }
    }
  } catch {
    names = [];
  }
  for (const name of names.sort()) {
    const path = `${KNOWLEDGE_STORE.topics}/${name}`;
    const file = readKnowledgeFile(root, path);
    if (!file) continue;
    topics.push({
      path,
      // A file longer than one read is measured by what was read: already over.
      bytes: file.truncated
        ? Number.MAX_SAFE_INTEGER
        : Buffer.byteLength(file.body),
      entries: knowledgeEntries(path, file.body),
    });
  }
  const index = table
    ? {
        bytes: table.truncated
          ? Number.MAX_SAFE_INTEGER
          : Buffer.byteLength(table.body),
        ...knowledgeRoutes(table.body),
      }
    : null;
  return {
    index,
    topics,
    limited,
    totalBytes:
      (index?.bytes ?? 0) + topics.reduce((sum, topic) => sum + topic.bytes, 0),
  };
}
function fileHas(root: string, path: string, symbol: string | null): boolean {
  if (/\.md$/iu.test(path)) {
    const file = readKnowledgeFile(root, path);
    return !!file && (symbol === null || file.body.includes(symbol));
  }
  try {
    const stat = lstatSync(safeWorkflowFile(root, path));
    if (!stat.isFile() && !stat.isDirectory()) return false;
    if (symbol === null) return true;
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return false;
    return readSource(root, path).includes(symbol);
  } catch {
    return false;
  }
}
function readSource(root: string, path: string): string {
  return readFileSync(safeWorkflowFile(root, path), "utf8");
}
const size = (bytes: number) =>
  bytes === Number.MAX_SAFE_INTEGER ? "more than one read" : `${bytes} bytes`;

export interface KnowledgeLint {
  findings: KnowledgeFinding[];
  /** Entries about code this delivery changed: the curator checks them again. */
  revalidate: KnowledgeEntry[];
  usage: {
    indexBytes: number;
    totalBytes: number;
    topics: { path: string; bytes: number; entries: number }[];
  };
}
/** Deterministic checks of the store against the tree at `root`. `changed` is
 * what this delivery changed: a budget violation always fails it; a broken
 * reference fails it only where this delivery wrote the entry or moved its
 * target, and is otherwise a note for the curator and the review. */
export function lintKnowledge(
  root: string,
  changed: readonly string[],
): KnowledgeLint {
  const store = readKnowledgeStore(root);
  const touched = (path: string) => workflowCovers(changed, path);
  const findings: KnowledgeFinding[] = [];
  const over = (path: string, detail: string) =>
    findings.push({ kind: "over-budget", path, detail, blocking: true });
  if (store.index && store.index.bytes > KNOWLEDGE_STORE.indexBytes)
    over(
      KNOWLEDGE_STORE.index,
      `the route table is ${size(store.index.bytes)}; its budget is ${KNOWLEDGE_STORE.indexBytes}`,
    );
  if (store.limited)
    over(
      KNOWLEDGE_STORE.topics,
      `more than ${KNOWLEDGE_STORE.topicFiles} topic files`,
    );
  if (store.totalBytes > KNOWLEDGE_STORE.totalBytes)
    over(
      KNOWLEDGE_STORE.topics,
      `the store is ${size(store.totalBytes)}; its budget is ${KNOWLEDGE_STORE.totalBytes}`,
    );
  for (const line of store.index?.unparsed ?? [])
    findings.push({
      kind: "unparsed-route",
      path: KNOWLEDGE_STORE.index,
      detail: line,
      blocking: touched(KNOWLEDGE_STORE.index),
    });
  for (const route of store.index?.routes ?? []) {
    const target = readKnowledgeFile(root, route.target);
    if (
      !target ||
      (route.section !== null &&
        knowledgeSection(target.body, route.section) === null)
    )
      findings.push({
        kind: "dead-route",
        path: KNOWLEDGE_STORE.index,
        detail: `${route.target}${route.section ? `#${route.section}` : ""} does not resolve`,
        blocking: touched(KNOWLEDGE_STORE.index) || touched(route.target),
      });
  }
  const revalidate: KnowledgeEntry[] = [];
  for (const topic of store.topics) {
    const mine = touched(topic.path);
    if (topic.bytes > KNOWLEDGE_STORE.topicBytes)
      over(
        topic.path,
        `the topic is ${size(topic.bytes)}; its budget is ${KNOWLEDGE_STORE.topicBytes}`,
      );
    const seen = new Set<string>();
    for (const entry of topic.entries) {
      if (entry.bytes > KNOWLEDGE_STORE.entryBytes)
        over(
          topic.path,
          `entry "${entry.title}" is ${entry.bytes} bytes; an entry's budget is ${KNOWLEDGE_STORE.entryBytes}`,
        );
      const key = slug(entry.title);
      if (seen.has(key))
        findings.push({
          kind: "duplicate",
          path: topic.path,
          detail: `entry "${entry.title}" appears more than once`,
          blocking: mine,
        });
      seen.add(key);
      if (!entry.anchors.length)
        findings.push({
          kind: "unanchored",
          path: topic.path,
          detail: `entry "${entry.title}" names no anchor`,
          blocking: mine,
        });
      for (const anchor of entry.anchors) {
        const moved = touched(anchor.path);
        if (!fileHas(root, anchor.path, anchor.symbol))
          findings.push({
            kind: "dead-anchor",
            path: topic.path,
            detail: `entry "${entry.title}": ${anchor.path}${anchor.symbol ? `#${anchor.symbol}` : ""} does not resolve`,
            blocking: mine || moved,
          });
      }
      if (entry.anchors.some((anchor) => touched(anchor.path)))
        revalidate.push(entry);
    }
  }
  return {
    findings,
    revalidate,
    usage: {
      indexBytes: store.index?.bytes ?? 0,
      totalBytes: store.totalBytes,
      topics: store.topics.map((topic) => ({
        path: topic.path,
        bytes: topic.bytes,
        entries: topic.entries.length,
      })),
    },
  };
}
