import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readBounded } from "./workspace.ts";

export const AGENT_FILES = [
  "design-explorer.md",
  "route-planner.md",
  "implementation-worker.md",
  "diagnosis-worker.md",
] as const;
export function loadAgentDefinitions() {
  return AGENT_FILES.map((fileName) => {
    const path = fileURLToPath(
      new URL(`../agents/${fileName}`, import.meta.url),
    );
    const data = readBounded(path, 32768, true);
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
