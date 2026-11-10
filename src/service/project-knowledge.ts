/** Project knowledge is source-backed Markdown, not a second conversation store.
 * Discovery is readonly, shallow and nonactivating. Existing engineering/docs/specs
 * remain authoritative; the generated project index only points to them. */

import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
} from "node:fs";
import { dirname, posix } from "node:path";
import { sanitizeText } from "../worker-redaction.mjs";
import type { WorkflowReading } from "./contracts/workflow.ts";
import {
  KNOWLEDGE_STORE,
  type KnowledgeLint,
  knowledgeRoutes,
  knowledgeSection,
  matchKnowledgeRoutes,
  routeLabel,
} from "./knowledge-store.ts";
import { safeWorkflowFile } from "./workflow-git.ts";

export const KNOWLEDGE_LIMITS = {
  fileBytes: 64 * 1024,
  candidates: 160,
  entries: 2048,
  terms: 64,
  contextBytes: 12 * 1024,
  /** One discovered document's share, and one named source's (a whole topic). */
  sourceBytes: 4096,
  namedBytes: 8 * 1024,
  depth: 3,
} as const;
/** What the project and the agreement name for one reader, ahead of discovery. */
export interface KnowledgeNamed {
  /** Documents (and sections) the agreement names for this assignment or review. */
  reads?: readonly WorkflowReading[];
  /** Already-resolved text from outside the tree, such as a recorded investigation. */
  extra?: readonly { label: string; reason: string; body: string }[];
}
interface Leading {
  path: string;
  reason: string;
  body: string;
  truncated: boolean;
}
/** A long run of Han characters is a sentence, not a word: it is also offered
 * as its two-character pieces so a Chinese goal can match Chinese documents. */
function pieces(token: string): string[] {
  if (!/\p{Script=Han}/u.test(token) || [...token].length <= 2) return [token];
  const chars = [...token];
  const out = [token];
  for (let i = 0; i + 1 < chars.length && out.length <= 24; i++)
    out.push(chars[i] + chars[i + 1]);
  return out;
}
/** The part of a document worth its allowance: the whole when it fits, else
 * the sections that mention the most of the reader's terms, in document
 * order. With no term in any section it is the beginning, as before. */
function relevant(
  body: string,
  terms: readonly string[],
  allowance: number,
  clip: (value: string, bytes: number) => string,
): string {
  if (Buffer.byteLength(body) <= allowance) return body;
  const blocks: string[] = [];
  let code = false;
  for (const line of body.split("\n")) {
    if (/^\s*(?:```|~~~)/u.test(line)) code = !code;
    if (!code && /^#{1,6}\s/u.test(line)) blocks.push(line);
    else if (blocks.length) blocks[blocks.length - 1] += `\n${line}`;
    else blocks.push(line);
  }
  const scored = blocks.map((text, index) => {
    const lower = text.toLowerCase();
    return {
      text,
      index,
      score: terms.reduce((n, term) => n + (lower.includes(term) ? 1 : 0), 0),
    };
  });
  if (blocks.length < 2 || scored.every((block) => !block.score))
    return clip(body, allowance);
  const chosen: typeof scored = [];
  let used = 0;
  for (const block of [...scored].sort(
    (a, b) => b.score - a.score || a.index - b.index,
  )) {
    if (!block.score) break;
    const bytes = Buffer.byteLength(block.text) + 1;
    if (used + bytes > allowance) continue;
    chosen.push(block);
    used += bytes;
  }
  if (!chosen.length)
    return clip(scored.sort((a, b) => b.score - a.score)[0].text, allowance);
  return chosen
    .sort((a, b) => a.index - b.index)
    .map((block) => block.text.trimEnd())
    .join("\n");
}
export interface KnowledgeSource {
  path: string;
  reason: string;
  digest: string;
  excerpt: string;
  truncated: boolean;
}
export interface KnowledgeContext {
  sources: KnowledgeSource[];
  omitted: string[];
  /** What the route table led this reader to, by label, whether or not it fit. */
  routed: string[];
  text: string;
}
const roots = ["engineering", "docs", ".trellis/spec", ".cadence/knowledge"];
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const markdown = (p: string) =>
  /\.md$/iu.test(p) &&
  !/^(?:\.cadence\/assistant|\.trellis\/(?:workspace|tasks))(?:\/|$)/u.test(
    p,
  ) &&
  !p
    .split("/")
    .some(
      (part) =>
        part === ".." ||
        part === ".git" ||
        part === "node_modules" ||
        part.startsWith(".env") ||
        (part.startsWith(".") && part !== ".cadence" && part !== ".trellis"),
    );
/** One project Markdown file, read whole or up to the per-file bound. Unsafe,
 * linked, private or non-text files are absent, never repaired. */
export function readKnowledgeFile(
  root: string,
  path: string,
): { body: string; truncated: boolean } | null {
  if (!markdown(path)) return null;
  let fd: number | undefined;
  try {
    const file = safeWorkflowFile(root, path);
    const selected = lstatSync(file);
    fd = openSync(
      file,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const before = fstatSync(fd);
    if (selected.dev !== before.dev || selected.ino !== before.ino) return null;
    if (!before.isFile() || before.nlink !== 1) return null;
    const buffer = Buffer.alloc(
      Math.min(before.size, KNOWLEDGE_LIMITS.fileBytes),
    );
    let bytes = 0;
    while (bytes < buffer.length) {
      const n = readSync(fd, buffer, bytes, buffer.length - bytes, bytes);
      if (!n) break;
      bytes += n;
    }
    const after = fstatSync(fd);
    const located = lstatSync(file);
    if (located.dev !== before.dev || located.ino !== before.ino) return null;
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      return null;
    let body = buffer.subarray(0, bytes);
    // Only a partial final UTF-8 character may be removed; invalid text is not knowledge.
    if (before.size > bytes)
      for (let i = 0; i < 3 && !isUtf8(body); i++) body = body.subarray(0, -1);
    if (!isUtf8(body) || body.includes(0)) return null;
    return { body: body.toString("utf8"), truncated: before.size > bytes };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
/** Fresh reads on each launch: a knowledge edit invalidates the next context naturally. */
export function projectKnowledge(
  root: string,
  query: string,
  paths: string[],
  secrets: readonly string[],
  maximum = KNOWLEDGE_LIMITS.contextBytes,
  named: KnowledgeNamed = {},
): KnowledgeContext {
  const candidates = new Map<string, { reason: string; priority: number }>();
  const omitted: string[] = [];
  // What the project and the agreement point at comes first, in this order:
  // the route table, what the agreement names for this reader, then the
  // documents the table routes these write paths to. Discovery only fills
  // what is left.
  const leading: Leading[] = [];
  const lead = (
    label: string,
    reason: string,
    body: string | null,
    truncated = false,
  ) => {
    if (leading.some((row) => row.path === label)) return;
    if (body === null) omitted.push(`${label}: absent, unsafe or unreadable`);
    else leading.push({ path: label, reason, body, truncated });
  };
  const document = (path: string, section: string | null, reason: string) => {
    const file = markdown(path) ? readKnowledgeFile(root, path) : null;
    const label = section ? `${path}#${section}` : path;
    if (!file) return lead(label, reason, null);
    if (section === null) return lead(label, reason, file.body, file.truncated);
    lead(label, reason, knowledgeSection(file.body, section));
  };
  const table = readKnowledgeFile(root, KNOWLEDGE_STORE.index);
  if (table)
    lead(
      KNOWLEDGE_STORE.index,
      "Route table: which documents own which code",
      table.body,
      table.truncated,
    );
  for (const reading of named.reads ?? [])
    if ("path" in reading)
      document(
        reading.path,
        reading.section ?? null,
        `Named by the agreement: ${reading.reason}`,
      );
  for (const extra of named.extra ?? [])
    lead(extra.label, extra.reason, extra.body);
  const routed: string[] = [];
  if (table)
    for (const route of matchKnowledgeRoutes(
      knowledgeRoutes(table.body).routes,
      paths,
    )) {
      routed.push(routeLabel(route));
      document(
        route.target,
        route.section,
        `Routed for ${route.patterns.join(", ")}${route.summary ? `: ${route.summary}` : ""}`,
      );
    }
  let entries = 0,
    discoveryLimited = false;
  const add = (path: string, reason: string, priority: number) => {
    if (candidates.size < KNOWLEDGE_LIMITS.candidates && markdown(path)) {
      const previous = candidates.get(path);
      if (!previous || previous.priority < priority)
        candidates.set(path, { reason, priority });
    }
  };
  add("AGENTS.md", "Project instructions", 1000);
  for (const path of paths) {
    if (markdown(path)) add(path, "Relevant approved documentation", 800);
    let parent = posix.dirname(path);
    while (parent !== ".") {
      add(`${parent}/AGENTS.md`, "Instructions for this assignment", 950);
      parent = posix.dirname(parent);
    }
  }
  for (const base of roots) {
    const visit = (path: string, depth: number) => {
      if (
        depth > KNOWLEDGE_LIMITS.depth ||
        entries >= KNOWLEDGE_LIMITS.entries ||
        candidates.size >= KNOWLEDGE_LIMITS.candidates
      ) {
        discoveryLimited = true;
        return;
      }
      let directory: ReturnType<typeof opendirSync> | undefined;
      try {
        // Validate every ancestor before walking; no linked/private tree traversal.
        const probe = safeWorkflowFile(root, `${path}/index.md`);
        directory = opendirSync(dirname(probe));
        while (
          entries < KNOWLEDGE_LIMITS.entries &&
          candidates.size < KNOWLEDGE_LIMITS.candidates
        ) {
          const entry = directory.readSync();
          if (!entry) break;
          entries++;
          if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
          const name = `${path}/${entry.name}`;
          if (entry.isDirectory()) visit(name, depth + 1);
          else if (entry.isFile())
            add(
              name,
              "Related project knowledge",
              entry.name === "index.md" ? 40 : 0,
            );
        }
      } catch {
        /* Missing or unsafe documents never activate, repair or create a project. */
      } finally {
        directory?.closeSync();
      }
    };
    visit(base, 0);
  }
  const terms = [
    ...new Set(
      // Write paths discriminate best, so they are never the ones cut off.
      `${paths.join(" ")} ${query}`
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .flatMap(pieces)
        .filter((s) => s.length > 2 || /\p{Script=Han}/u.test(s)),
    ),
  ];
  if (terms.length > KNOWLEDGE_LIMITS.terms) {
    terms.length = KNOWLEDGE_LIMITS.terms;
    omitted.push(
      "Keyword selection reached its observation bound; consult full project indexes on demand.",
    );
  }
  const rows: (KnowledgeSource & { score: number; limit: number })[] =
    leading.map((row, index) => {
      const body = sanitizeText(row.body, secrets);
      return {
        path: row.path,
        reason: row.reason,
        digest: digest(row.body),
        excerpt: body,
        truncated: row.truncated,
        // Above every discovered document, in the order they were named.
        score: 1_000_000 - index,
        limit: KNOWLEDGE_LIMITS.namedBytes,
      };
    });
  const included = new Set(leading.map((row) => row.path.split("#")[0]));
  for (const [path, { reason, priority }] of candidates) {
    // Already there as named: whole, or as the section that was asked for.
    if (included.has(path)) continue;
    if (sanitizeText(path, secrets) !== path) {
      omitted.push("Protected document path omitted");
      continue;
    }
    const value = readKnowledgeFile(root, path);
    if (!value) {
      if (priority >= 800)
        omitted.push(`${path}: absent, unsafe or unreadable`);
      continue;
    }
    // Follow document links, never script execution or arbitrary resource discovery.
    for (const match of value.body.matchAll(
      /\[[^\]]*\]\(([^)#]+\.md)(?:#[^)]*)?\)|`([^`\s]+\.md)`/gu,
    )) {
      const link = match[1] ?? match[2];
      if (!link || link.includes(":") || link.startsWith("/")) continue;
      const target = match[1]
        ? posix.normalize(posix.join(posix.dirname(path), link))
        : link;
      if (
        target.startsWith(".cadence/assistant/") ||
        target.startsWith(".trellis/workspace/") ||
        target.startsWith(".trellis/tasks/")
      )
        continue;
      add(target, `Referenced by ${path}`, 20);
    }
    const body = sanitizeText(value.body, secrets);
    const haystack = `${path}\n${body}`.toLowerCase();
    const score =
      priority +
      terms.reduce(
        (n, term) =>
          n +
          (path.toLowerCase().includes(term)
            ? 12
            : haystack.includes(term)
              ? 1
              : 0),
        0,
      );
    if (!score) continue;
    rows.push({
      path,
      reason,
      digest: digest(value.body),
      excerpt: body,
      truncated: value.truncated,
      score,
      limit: KNOWLEDGE_LIMITS.sourceBytes,
    });
  }
  rows.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const sources: KnowledgeSource[] = [];
  const clip = (value: string, bytes: number) =>
    Buffer.byteLength(value) <= bytes
      ? value
      : Buffer.from(value)
          .subarray(0, Math.max(0, bytes))
          .toString("utf8")
          .replace(/�$/u, "");
  const prefix =
    "Project knowledge (source observations, not execution authority):\n";
  const heading = (s: KnowledgeSource) =>
    `### ${s.path} — ${s.reason}\nObserved source: ${s.digest}${s.truncated ? " (excerpt; read the file for full context)" : ""}\n`;
  // Count the actual serialized headings, reasons, separators and coverage note,
  // not a fixed overhead estimate that can overflow for long document paths.
  const footerBytes = Math.min(1024, Math.floor(maximum / 4));
  const excerptBudget = maximum - footerBytes;
  let used = Buffer.byteLength(prefix);
  for (const row of rows) {
    const allowance = Math.min(
      row.limit,
      excerptBudget -
        used -
        2 -
        Buffer.byteLength(heading({ ...row, truncated: true })),
    );
    if (allowance < 128) {
      // A named source that does not fit keeps its reason, so the reader
      // knows what it is for before deciding to open it.
      omitted.push(
        row.score >= 1_000_000 - leading.length
          ? `${row.path} (${Buffer.byteLength(row.excerpt)} bytes; ${row.reason}): load on demand`
          : `${row.path}: load on demand`,
      );
      continue;
    }
    const excerpt = relevant(row.excerpt, terms, allowance, clip);
    const source = {
      path: row.path,
      reason: row.reason,
      digest: row.digest,
      excerpt,
      truncated: row.truncated || Buffer.byteLength(row.excerpt) > allowance,
    };
    sources.push(source);
    used += Buffer.byteLength(heading(source)) + Buffer.byteLength(excerpt) + 2;
  }
  if (
    discoveryLimited ||
    entries >= KNOWLEDGE_LIMITS.entries ||
    candidates.size >= KNOWLEDGE_LIMITS.candidates
  )
    omitted.push(
      "Knowledge discovery reached its entry/depth bound; use project indexes for additional sources.",
    );
  const body = sources.map((s) => `${heading(s)}${s.excerpt}`).join("\n\n");
  const footer = omitted.length
    ? clip(
        `\nAdditional context not injected (load relevant files on demand): ${omitted.join("; ")}`,
        footerBytes,
      )
    : "";
  const context = body
    ? `${prefix}${body}`
    : "No relevant project knowledge was injected. Read applicable project instructions and adjacent documentation before work.";
  return {
    sources,
    omitted,
    routed,
    text: clip(context, maximum - Buffer.byteLength(footer)) + footer,
  };
}

/** What the curator is given about the store before it edits. */
export interface CurationBrief {
  /** Existing project documents the agreement also lets this delivery update. */
  documents: readonly string[];
  /** Whether the managed store may be maintained in this delivery. */
  managed: boolean;
  usage: KnowledgeLint["usage"];
  /** Entries about code this delivery changed. */
  revalidate: readonly { topic: string; title: string }[];
  /** Findings that do not fail the delivery but should be settled when cheap. */
  notes: readonly string[];
  /** The topic that has gone longest without a look, if any. */
  rotation: string | null;
  /** Routes no worker has been routed to for a long time. */
  idle: readonly string[];
  /** What the workers of this delivery proposed as lessons, unverified. */
  lessons: string;
  /** What failed and how the route was revised, oldest first. */
  history: string;
  /** Recorded deviations from the agreement. */
  deviations: string;
}
/** The curator keeps the store a small, current cache of what cannot be
 * cheaply re-derived from the code. It is run once per delivery, after the
 * implementation passed its checks and review. */
export function curationInstructions(brief: CurationBrief): string {
  const store = KNOWLEDGE_STORE;
  const managed = brief.managed
    ? `You maintain the project's knowledge store: the route table ${store.index} and topic cards under ${store.topics}/. It is a bounded cache, not a growing document: it holds what a capable engineer could not cheaply re-derive from the code, and new knowledge must displace or compress old knowledge.
Budget, enforced after you finish (exceeding it fails this delivery): route table ${store.indexBytes} bytes; one topic ${store.topicBytes} bytes; one entry ${store.entryBytes} bytes; the whole store ${store.totalBytes} bytes; at most ${store.topicFiles} topics. Now: route table ${brief.usage.indexBytes} bytes; store ${brief.usage.totalBytes} bytes; ${brief.usage.topics.map((t) => `${t.path} ${t.bytes} bytes/${t.entries} entries`).join("; ") || "no topics yet"}.
Format. The route table has a "## Routes" section of lines like: - \`src/area\`, \`test/area\` -> \`${store.topics}/topic.md#Heading\` — what that settles. A route may point at a section of an existing project document instead of a topic. A topic is "# Title", "## Section" headings and entries; an entry is "### One sentence stating the rule or fact" followed by short lines "Kind: contract | decision | pitfall | practice", "Why: one line", "Anchors: \`path#symbol-or-test-name\`, \`path\`" and "Source: this delivery, date". Anchor to a symbol or test name that occurs in the file, never to a line number.
Admit only what is worth a reader's attention next time: a contract between parts, a decision and its reason, a pitfall this delivery actually hit, a verification recipe. Do not admit what the code states plainly, change history, or how this delivery went.
For every candidate lesson choose one: merge it into an existing entry, add an entry, or drop it. Finding nothing reusable is a valid result; never manufacture a rule.
When space is needed, remove in this order: entries whose anchors no longer resolve; duplicates and entries a newer one replaces; entries now guaranteed by a test or a type (the check is the knowledge); routes nothing has needed for a long time, with the entries only they lead to, and entries about code that no longer matters; only then shorten wording, without dropping a condition. Split a topic that mixes areas; delete a topic left empty and its routes.
${brief.usage.indexBytes ? "" : `There is no route table yet: create ${store.index} with a short "## Routes" section that routes the areas this delivery touched to the sections of the existing project documents (AGENTS.md, engineering/, docs/) that own them, and add a topic only for what no existing document owns.\n`}Entries to check again because this delivery changed the code they are about (correct, re-anchor or remove each): ${brief.revalidate.map((e) => `${e.topic} "${e.title}"`).join("; ") || "none"}.
${brief.rotation ? `Also look over ${brief.rotation}, which has gone longest without a check: remove or correct what is stale.\n` : ""}${brief.idle.length ? `No worker of the last ${store.idleDeliveries} deliveries was routed to these; keep one only if it still earns its place: ${brief.idle.join("; ")}\n` : ""}${brief.notes.length ? `Open findings about the store (settle the cheap ones): ${brief.notes.join("; ")}\n` : ""}`
    : "The project's knowledge store is not maintained in this delivery.\n";
  const documents = brief.documents.length
    ? `Existing project documents you may also update, preserving human text and unrelated conventions, in the owner of each fact and never as a duplicate: ${brief.documents.join(", ")}.\n`
    : "";
  return `Maintain project knowledge from the actual implemented files and current check evidence, not from the initial plan's predictions.
${managed}${documents}What this delivery went through (failures and how the route was revised; the most valuable lessons are usually here):
${brief.history || "No recorded failure or revision."}
${brief.deviations ? `Recorded deviations from the agreement:\n${brief.deviations}\n` : ""}${brief.lessons ? `Lessons this delivery's workers proposed. They are unverified proposals: check each against the committed code, and admit one only if it is true, not already recorded and not plain from the code:\n${brief.lessons}\n` : ""}Do not publish guesses, credentials, raw logs, personal history, temporary paths or anything that is not true of the committed code. Do not modify implementation code, tests or anything outside the paths named here.`;
}
