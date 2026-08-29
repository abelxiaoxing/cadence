// Verify that every Requirement/Scenario in the active control-plane change is
// owned exactly once by tasks.md and that every task reference resolves to the
// exact delta-spec heading it names.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const changeName = "redesign-abel-workflow-control-plane";
const changeRoot = path.join(root, "openspec", "changes", changeName);
const tasks = readFileSync(path.join(changeRoot, "tasks.md"), "utf8");
const specsRoot = path.join(changeRoot, "specs");
const specPaths = readdirSync(specsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join("specs", entry.name, "spec.md"))
  .sort();

const headings = new Set();
for (const specPath of specPaths) {
  const text = readFileSync(path.join(changeRoot, specPath), "utf8");
  let requirement = "";
  for (const line of text.split("\n")) {
    const requirementMatch = line.match(/^### Requirement: (.+)$/);
    if (requirementMatch) {
      requirement = requirementMatch[1].trim();
      continue;
    }
    const scenarioMatch = line.match(/^#### Scenario: (.+)$/);
    if (scenarioMatch && requirement) {
      const reference = `${specPath}#${requirement}/${scenarioMatch[1].trim()}`;
      if (headings.has(reference)) {
        throw new Error(`duplicate spec heading: ${reference}`);
      }
      headings.add(reference);
    }
  }
}

const references = [
  ...tasks.matchAll(/`(specs\/[^`\n]+\/spec\.md#[^`\n]+)`/g),
].map((match) => match[1].trim());
const referenceSet = new Set(references);
const missing = references.filter((reference) => !headings.has(reference));
const duplicates = references.filter(
  (reference, index) => references.indexOf(reference) !== index,
);
const unowned = [...headings].filter(
  (reference) => !referenceSet.has(reference),
);

if (missing.length > 0) {
  throw new Error(
    `unresolved references: ${JSON.stringify([...new Set(missing)])}`,
  );
}
if (duplicates.length > 0) {
  throw new Error(
    `duplicate ownership: ${JSON.stringify([...new Set(duplicates)])}`,
  );
}
if (unowned.length > 0) {
  throw new Error(`unowned scenarios: ${JSON.stringify(unowned)}`);
}

if (process.argv.includes("--review-json")) {
  const input = readFileSync(0, "utf8");
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
    "outcome",
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
  if (review.outcome !== "accepted") {
    throw new Error("review evidence outcome is not accepted");
  }
  console.log(
    "review-check: structured evidence accepted with no unresolved issues",
  );
  process.exit(0);
}

console.log(
  `traceability-check: ${references.length} active Requirement/Scenario references resolve exactly once`,
);
