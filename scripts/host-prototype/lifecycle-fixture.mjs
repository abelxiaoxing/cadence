import { spawn } from "node:child_process";
import { readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function main() {
  const [mode, directory, ...args] = process.argv.slice(2);
  const root = realpathSync(directory);
  if (
    !basename(root).startsWith("cadence-host-fixture-") ||
    readFileSync(join(root, ".fixture"), "utf8") !== "host-prototype-v1"
  )
    throw new Error("generated fixture root required");
  const witness = (name, value) => {
    const temporary = join(root, `${name}.tmp`);
    writeFileSync(temporary, JSON.stringify(value), { flag: "wx" });
    renameSync(temporary, join(root, name));
  };
  witness(`${mode}.pid`, process.pid);
  if (mode === "descendant") {
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  } else if (mode === "tree" || mode === "root-exit") {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "descendant", root],
      {
        env: process.env,
        stdio: "ignore",
        // A shared Windows console can terminate the child with its parent.
        // Keep macOS descendants in the inherited process group under test.
        detached: process.platform === "win32",
      },
    );
    child.on("error", () => process.exit(1));
    child.unref();
    if (mode === "tree") {
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
    }
  } else if (mode === "stream") {
    witness("witness.json", {
      argv: args,
      cwd: process.cwd(),
      environmentPresent:
        process.platform === "win32"
          ? typeof process.env.SystemRoot === "string"
          : typeof process.env.PATH === "string",
    });
    process.stdout.write("fixture-witness:中文\n");
  } else if (mode === "flood") {
    const write = () => {
      if (process.stdout.write("x".repeat(1024))) setImmediate(write);
      else process.stdout.once("drain", write);
    };
    write();
  } else throw new Error("invalid fixture mode");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch {
    console.error("fixture failed");
    process.exitCode = 1;
  }
}
