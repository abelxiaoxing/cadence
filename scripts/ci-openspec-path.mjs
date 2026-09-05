import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

const prefix = process.env.npm_config_prefix;
const output = process.env.GITHUB_PATH;
if (!prefix || !path.isAbsolute(prefix) || !output) {
  throw new Error("ci-openspec-path-configuration-invalid");
}
const directory =
  process.platform === "win32" ? prefix : path.join(prefix, "bin");
const command = path.join(
  directory,
  process.platform === "win32" ? "openspec.cmd" : "openspec",
);
if (!existsSync(command)) throw new Error("ci-openspec-global-shim-missing");
if (
  process.platform === "win32" &&
  existsSync(path.join(directory, "openspec.exe"))
) {
  throw new Error("ci-openspec-unexpected-native-executable");
}
appendFileSync(output, `${directory}\n`);
