/** Pi's standard readonly file tools, at the admitted investigation location.
 * No second file protocol, scanner, cursor registry or model-managed cleanup. */
import { readFile, stat } from "node:fs/promises";
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  detectSupportedImageMimeTypeFromFile,
} from "@earendil-works/pi-coding-agent";

export const RESEARCH_INSTRUCTIONS =
  "Use Pi's read, grep, find and ls tools directly. read accepts one path with optional offset/limit; follow its next-offset notice for more text. grep accepts one pattern, find accepts a glob, and ls lists a directory. Searches respect .gitignore; use explicit paths and directory listings when investigating ignored dependencies or backups. Explicit absolute paths outside the checkout remain readable. Relative paths use the first investigation root. These are live filesystem reads, not a snapshot: report truncation and unresolved coverage honestly. There is no bash, write or edit tool in this readonly role; shell work belongs to an authorized implementation. Keep credentials and private session content out of reports.";

export function createResearchTools(workspace) {
  const cwd = workspace.roots[0];
  const definitions = [
    createReadToolDefinition(cwd, {
      operations: {
        readFile,
        detectImageMimeType: detectSupportedImageMimeTypeFromFile,
        async access(path) {
          // Pi resolves paths first. Follow regular-file aliases, but never
          // intentionally open a device, socket, pipe or directory for reading.
          if (!(await stat(path)).isFile())
            throw new Error("Only regular files can be read");
        },
      },
    }),
    createGrepToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createLsToolDefinition(cwd),
  ];
  return {
    tools: definitions.map((tool) => ({
      ...tool,
      async execute(id, args, signal, update, context) {
        if (signal?.aborted) throw new Error("Investigation canceled");
        // The worker already enforces offline mode before creating its session.
        // Keep direct uses equally noninstalling without changing ambient env.
        if (
          ["grep", "find"].includes(tool.name) &&
          process.env.PI_OFFLINE !== "1"
        )
          throw new Error(
            "Readonly search requires PI_OFFLINE=1; no tools were downloaded",
          );
        const selected = { ...context, cwd };
        // Original-operation accounting and cancellation belong to the toolkit,
        // just as they do for the standard file tools of an editing worker.
        return tool.execute(id, args, signal, update, selected);
      },
    })),
  };
}
