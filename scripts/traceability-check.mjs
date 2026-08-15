// P-007 traceability check: verify that every Requirement/Scenario reference
// in tasks.md resolves to a heading in the two spec files, and that the 81
// stable references are owned exactly once across the executable task IDs.
// P-008 consumes this map for the read-only final audit.
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const tasks = readFileSync(
  path.join(
    root,
    "openspec",
    "changes",
    "extract-workflow-add-private-agent-orchestration",
    "tasks.md",
  ),
  "utf8",
);

const specPaths = [
  "openspec/changes/extract-workflow-add-private-agent-orchestration/specs/abel-workflow-prompt-package/spec.md",
  "openspec/changes/extract-workflow-add-private-agent-orchestration/specs/private-agent-orchestration/spec.md",
];

const headings = new Set();
for (const specPath of specPaths) {
  const text = readFileSync(path.join(root, specPath), "utf8");
  let section = "";
  for (const line of text.split("\n")) {
    const sectionMatch = line.match(/^### (?:Requirement|Scenario): (.+)$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const itemMatch = line.match(/^#### (Requirement|Scenario): (.+)$/);
    if (itemMatch && section) {
      headings.add(`${section}/${itemMatch[2].trim()}`);
    }
  }
}

const references = [...tasks.matchAll(/spec\.md#([^\n`]+)/g)].map((m) =>
  m[1].trim().replace(/\s+$/g, ""),
);

const missing = references.filter((r) => !headings.has(r));
const duplicates = references.filter((r, i) => references.indexOf(r) !== i);

if (missing.length) {
  throw new Error(
    `unresolved references: ${JSON.stringify([...new Set(missing)])}`,
  );
}
if (duplicates.length) {
  throw new Error(
    `duplicate ownership: ${JSON.stringify([...new Set(duplicates)])}`,
  );
}

if (process.argv.includes("--review-json")) {
  const fs = await import("node:fs");
  const input = fs.readFileSync(0, "utf8");
  let review;
  try {
    review = JSON.parse(input);
  } catch {
    throw new Error("review evidence is not valid JSON");
  }
  const required = [
    "reviewer",
    "identity",
    "reviewedArtifacts",
    "suiteEvidence",
    "traceabilityFindings",
    "dagFindings",
    "unresolvedIssues",
    "nextStep",
  ];
  for (const field of required) {
    if (!(field in review)) {
      throw new Error(`review evidence missing field: ${field}`);
    }
  }
  if (
    !Array.isArray(review.unresolvedIssues) ||
    review.unresolvedIssues.length > 0
  ) {
    throw new Error("review evidence has unresolved issues");
  }
  if (
    !Array.isArray(review.reviewedArtifacts) ||
    review.reviewedArtifacts.length === 0
  ) {
    throw new Error("review evidence has no reviewed artifacts");
  }
  console.log(
    "review-check: structured evidence accepted with no unresolved issues",
  );
  process.exit(0);
}

console.log(
  `traceability-check: ${references.length} unique references resolve exactly once`,
);
