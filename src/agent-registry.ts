// Immutable package-owned professional Agent registry. Files are loaded
// relative to this module and are never discovered from user or project Agent
// directories. The registry exposes no override or search-path API.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_FILES = [
  "design-explorer.md",
  "contract-reviewer.md",
  "implementation-worker.md",
  "diagnosis-worker.md",
] as const;

export interface AgentDefinition {
  role: string;
  fileName: string;
  path: string;
  sha256: string;
  bytes: number;
  content: string;
}

export function loadAgentDefinitions(): AgentDefinition[] {
  const agentsDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "agents",
  );
  return AGENT_FILES.map((fileName) => {
    const path = join(agentsDir, fileName);
    const st = statSync(path);
    if (!st.isFile()) {
      throw new Error(`agent definition is not a regular file: ${path}`);
    }
    const content = readFileSync(path, "utf8");
    return {
      role: fileName.replace(/\.md$/, ""),
      fileName,
      path,
      sha256: createHash("sha256").update(content).digest("hex"),
      bytes: Buffer.byteLength(content, "utf8"),
      content,
    };
  });
}

/** Deterministic role -> content hash map for identity verification. */
export function agentHashes(): Record<string, string> {
  return Object.fromEntries(
    loadAgentDefinitions().map((a) => [a.role, a.sha256]),
  );
}
