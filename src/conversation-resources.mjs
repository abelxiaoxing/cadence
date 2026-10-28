/** Ordinary Pi context only: no extension/plugin executor, persona or prompt composer. */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  loadProjectContextFiles,
  loadSkills,
} from "@earendil-works/pi-coding-agent";

function optional(path) {
  try {
    if (!statSync(path).isFile() || statSync(path).size > 64 * 1024)
      throw new Error("Resource too large");
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}
export function conversationResources(base, cwd, agentDir) {
  const project = join(cwd, ".pi");
  const system =
    optional(join(project, "SYSTEM.md")) ??
    optional(join(agentDir, "SYSTEM.md"));
  const append = [
    optional(join(agentDir, "APPEND_SYSTEM.md")),
    optional(join(project, "APPEND_SYSTEM.md")),
  ].filter((v) => v !== undefined);
  const agentsFiles = loadProjectContextFiles({ cwd, agentDir });
  const skills = loadSkills({
    cwd,
    agentDir,
    skillPaths: [],
    includeDefaults: true,
  });
  if (
    Buffer.byteLength(JSON.stringify({ system, append, agentsFiles, skills })) >
    256 * 1024
  )
    throw new Error("Resources too large");
  return {
    ...base,
    getSystemPrompt: () => system,
    getAppendSystemPrompt: () => append,
    getAgentsFiles: () => ({ agentsFiles }),
    getSkills: () => skills,
  };
}
