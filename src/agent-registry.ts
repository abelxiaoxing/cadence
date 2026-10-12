import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readBounded } from "./task-store.ts";

export const AGENT_FILES = [
  "design-explorer.md",
  "implementation-worker.md",
  "diagnosis-worker.md",
] as const;
export function loadAgentDefinitions() {
  return AGENT_FILES.map((fileName) => {
    const path = fileURLToPath(
      new URL(`../agents/${fileName}`, import.meta.url),
    );
    const data = readBounded(path, 32768);
    if (!data) throw new Error("Missing package Agent");
    return {
      role: fileName.replace(/\.md$/, ""),
      fileName,
      path,
      sha256: createHash("sha256").update(data).digest("hex"),
      bytes: data.length,
      content: data.toString("utf8"),
    };
  });
}
export function agentHashes(): Record<string, string> {
  return Object.fromEntries(
    loadAgentDefinitions().map((agent) => [agent.role, agent.sha256]),
  );
}
export function roleInstructions(
  kind: "code" | "research" | "diagnosis",
): string {
  const role =
    kind === "code"
      ? "implementation-worker"
      : kind === "research"
        ? "design-explorer"
        : "diagnosis-worker";
  const agent = loadAgentDefinitions().find((entry) => entry.role === role);
  if (!agent) throw new Error("Missing fixed role");
  return `${agent.content}\n\nCurrent Cadence workflow: ${kind === "code" ? "Edit the chosen working copy using ordinary host tools under the approved plan." : "Read-only investigation; do not modify files or delegate editing."}
Do not run Git mutations, install software, delete consumer data, or publish. No autonomous retry, nested worker, candidate sealing, transaction application, or certification is available. Report uncertainty and useful results honestly. Worker completion is NOT a passing check. Host tools are trusted tools, not a sandbox.`;
}
