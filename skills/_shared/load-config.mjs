import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function parseEnvFile(content) {
  const values = {};
  const lines = content
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0)
      throw new Error(`Invalid configuration syntax at line ${index + 1}`);

    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`Invalid configuration name at line ${index + 1}`);
    }

    let value = line.slice(separator + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      if (value.at(-1) !== quote) {
        throw new Error(
          `Unterminated quoted configuration value at line ${index + 1}`,
        );
      }
      value = value.slice(1, -1);
    }
    values[name] = value;
  }

  return values;
}

export function loadConfig({ cwd, home, required = [] }) {
  const projectPath = path.join(cwd, ".pi", "cadence", ".env");
  const userPath = path.join(home, ".pi", "agent", "cadence", ".env");
  const selectedPath = existsSync(projectPath)
    ? projectPath
    : existsSync(userPath)
      ? userPath
      : null;

  if (!selectedPath) {
    throw new Error(
      `No cadence configuration file found; create ${projectPath} or ${userPath}`,
    );
  }

  const values = parseEnvFile(readFileSync(selectedPath, "utf8"));
  const missing = required.filter((name) => !values[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration names in ${selectedPath}: ${missing.join(", ")}`,
    );
  }

  return { path: selectedPath, values };
}
