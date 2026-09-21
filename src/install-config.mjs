import { closeSync, constants, mkdirSync, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG_TEMPLATE = `# Cadence research configuration. Keep this file local and never commit it.
# Context7 works anonymously with its default URL.
# CONTEXT7_API_URL=https://context7.com/api/v2
# CONTEXT7_API_KEY=

# Required when using the Grok search skill.
GROK_API_URL=https://api.x.ai/v1
GROK_API_KEY=

# Optional Tavily integration.
# TAVILY_ENABLED=true
# TAVILY_API_URL=https://api.tavily.com
# TAVILY_API_KEY=
`;

export function ensureUserConfig(home = homedir()) {
  const directory = path.join(home, ".pi", "agent", "cadence");
  const file = path.join(directory, ".env");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    const fd = openSync(
      file,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    try {
      writeSync(fd, CONFIG_TEMPLATE, undefined, "utf8");
    } finally {
      closeSync(fd);
    }
    return { created: true, path: file };
  } catch (error) {
    if (error?.code === "EEXIST") return { created: false, path: file };
    throw error;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    const result = ensureUserConfig();
    if (result.created)
      process.stderr.write(`Cadence created ${result.path}\n`);
  } catch (error) {
    process.stderr.write(
      `Cadence could not create the user configuration template: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 0;
  }
}
