// Build a Windows distribution from an explicit native helper. No publish/download.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
if (
  process.platform !== "win32" ||
  process.arch !== "x64" ||
  args.length !== 4 ||
  args[0] !== "--helper" ||
  args[2] !== "--output"
)
  throw new Error(
    "Windows x64 required: pack-windows.mjs --helper <exe> --output <directory>",
  );
const root = path.resolve(import.meta.dirname, "..");
const helper = path.resolve(args[1]),
  output = path.resolve(args[3]);
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const manifest = JSON.parse(readFileSync(`${helper}.json`, "utf8"));
if (
  manifest.version !== 2 ||
  manifest.arch !== "x64" ||
  manifest.sourceSha256 !== hash(path.join(root, "src/windows-job.c")) ||
  manifest.helperSha256 !== hash(helper)
)
  throw new Error("Helper/source mismatch");
const stage = mkdtempSync(path.join(tmpdir(), "cadence-windows-pack-"));
const run = (cmd, argv, cwd) => {
  const result = spawnSync(cmd, argv, {
    cwd,
    shell: false,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.error)
    throw new Error(result.stderr || "Package command failed");
  return result.stdout;
};
try {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  for (const entry of [...pkg.files, "package.json"])
    cpSync(path.join(root, entry), path.join(stage, entry), {
      recursive: true,
    });
  cpSync(helper, path.join(stage, "src/windows-job.exe"));
  cpSync(`${helper}.json`, path.join(stage, "src/windows-job.exe.json"));
  mkdirSync(output, { recursive: true });
  run("bun", ["pm", "pack", "--destination", output], stage);
  const archives = readdirSync(output).filter((file) => file.endsWith(".tgz"));
  if (archives.length !== 1) throw new Error("Use an empty output directory");
  const archive = path.join(output, archives[0]);
  const actual = run("tar", ["tzf", archive], root)
    .split(/\r?\n/u)
    .filter((line) => line && !line.endsWith("/"));
  const expected = [
    ...JSON.parse(
      readFileSync(path.join(root, "provenance/package-members.json"), "utf8"),
    ),
    "package/src/windows-job.exe",
    "package/src/windows-job.exe.json",
  ].sort();
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected))
    throw new Error("Windows package member drift");
  console.log(archive);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
