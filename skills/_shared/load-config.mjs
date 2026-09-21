import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
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

function pathEntryExists(filePath) {
  try {
    // lstat, rather than existsSync, intentionally retains dangling symlinks.
    // They are an explicit configuration path and must fail closed when opened.
    lstatSync(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function selectConfigPath({ cwd, home }) {
  const projectPath = path.join(cwd, ".pi", "cadence", ".env");
  const userPath = path.join(home, ".pi", "agent", "cadence", ".env");
  return pathEntryExists(projectPath)
    ? projectPath
    : pathEntryExists(userPath)
      ? userPath
      : null;
}

export function loadConfig({ cwd, home, required = [], allowMissing = false }) {
  const selectedPath = selectConfigPath({ cwd, home });
  if (!selectedPath && allowMissing && required.length === 0) {
    return { path: null, values: {} };
  }

  if (!selectedPath) {
    const projectPath = path.join(cwd, ".pi", "cadence", ".env");
    const userPath = path.join(home, ".pi", "agent", "cadence", ".env");
    throw new Error(
      `No cadence configuration file found; create ${projectPath} or ${userPath}`,
    );
  }

  // Configuration inspection also runs at extension startup: never block on
  // a FIFO/device or read an unbounded file. Read one extra byte to detect growth.
  const maxBytes = 64 * 1024;
  const fd = openSync(selectedPath, constants.O_RDONLY | constants.O_NONBLOCK);
  let content;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new Error(
        "Cadence configuration must be a regular file of at most 64 KiB",
      );
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > maxBytes)
      throw new Error("Cadence configuration exceeds 64 KiB");
    content = buffer.subarray(0, size).toString("utf8");
  } finally {
    closeSync(fd);
  }
  const values = parseEnvFile(content);
  const missing = required.filter((name) => !values[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration names in ${selectedPath}: ${missing.join(", ")}`,
    );
  }

  return { path: selectedPath, values };
}
