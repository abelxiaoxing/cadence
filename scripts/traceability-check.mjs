// Verify that every Requirement/Scenario in the active control-plane change is
// owned exactly once by tasks.md and that every task reference resolves to the
// exact delta-spec heading it names.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const changesRoot = path.join(root, "openspec", "changes");

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

const activeChanges = readdirSync(changesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "archive")
  .map((entry) => entry.name)
  .sort();
let referenceCount = 0;
let checkedChanges = 0;

for (const changeName of activeChanges) {
  const changeRoot = path.join(changesRoot, changeName);
  const tasksPath = path.join(changeRoot, "tasks.md");
  const specsRoot = path.join(changeRoot, "specs");
  if (!existsSync(tasksPath) && !existsSync(specsRoot)) continue;
  if (!existsSync(tasksPath) || !existsSync(specsRoot)) {
    throw new Error(`incomplete traceability inputs: ${changeName}`);
  }
  checkedChanges += 1;
  const tasks = readFileSync(tasksPath, "utf8");
  const specPaths = filesBelow(specsRoot)
    .filter((absolute) => absolute.endsWith(`${path.sep}spec.md`))
    .map((absolute) =>
      path.relative(changeRoot, absolute).split(path.sep).join("/"),
    )
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
          throw new Error(`duplicate spec heading: ${changeName}:${reference}`);
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
      `${changeName} unresolved references: ${JSON.stringify([...new Set(missing)])}`,
    );
  }
  if (duplicates.length > 0) {
    throw new Error(
      `${changeName} duplicate ownership: ${JSON.stringify([...new Set(duplicates)])}`,
    );
  }
  if (unowned.length > 0) {
    throw new Error(
      `${changeName} unowned scenarios: ${JSON.stringify(unowned)}`,
    );
  }
  referenceCount += references.length;
}

console.log(
  `traceability-check: ${referenceCount} active Requirement/Scenario references across ${checkedChanges} change(s) resolve exactly once`,
);
