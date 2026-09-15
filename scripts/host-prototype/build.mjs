import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
export const hashFile = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
export function planBuild({
  platform,
  arch,
  output,
  compiler,
  compilerVersion,
  sdkVersion,
}) {
  if (platform !== "win32" || arch !== "x64")
    throw new Error("build unavailable: Windows x64 required");
  if (
    ![output, compiler].every(
      (p) =>
        typeof p === "string" &&
        /^[A-Za-z]:\\/.test(p) &&
        win32.isAbsolute(p) &&
        !/[\0\r\n"]/.test(p),
    ) ||
    !/^19\.(3\d|4\d)\.\d+$/.test(compilerVersion) ||
    !/^10\.0\.\d+\.0$/.test(sdkVersion)
  )
    throw new Error("build unavailable: supported explicit MSVC/SDK required");
  return {
    executable: compiler,
    argv: [
      "/nologo",
      "/W4",
      "/WX",
      "/O2",
      "/utf-8",
      "/DUNICODE",
      "/D_UNICODE",
      join(directory, "windows-launcher.c"),
      `/Fe:${win32.join(output, "windows-launcher.exe")}`,
      `/Fo:${win32.join(output, "windows-launcher.obj")}`,
    ],
    shell: false,
  };
}
export function validateManifest(manifest, hashes) {
  const fields = [
    "version",
    "recipe",
    "arch",
    "compilerVersion",
    "sdkVersion",
    "compilerSha256",
    "sourceSha256",
    "protocolSha256",
    "helperSha256",
  ];
  if (
    !manifest ||
    Object.keys(manifest).length !== fields.length ||
    fields.some((k) => !Object.hasOwn(manifest, k)) ||
    manifest.version !== 1 ||
    manifest.recipe !== 1 ||
    manifest.arch !== "x64" ||
    !/^19\.(3\d|4\d)\.\d+$/.test(manifest.compilerVersion) ||
    !/^10\.0\.\d+\.0$/.test(manifest.sdkVersion) ||
    fields
      .filter((k) => k.endsWith("Sha256"))
      .some((k) => !/^[a-f0-9]{64}$/.test(manifest[k])) ||
    ["sourceSha256", "protocolSha256", "helperSha256"].some(
      (k) => manifest[k] !== hashes[k],
    )
  )
    throw new Error("invalid/stale helper manifest");
  return manifest;
}
export function verifyHelper(helper) {
  const bytes = readFileSync(helper);
  const pe = bytes.length >= 64 ? bytes.readUInt32LE(60) : -1;
  if (
    bytes.toString("ascii", 0, 2) !== "MZ" ||
    pe < 64 ||
    pe + 6 > bytes.length ||
    bytes.readUInt32LE(pe) !== 0x4550 ||
    bytes.readUInt16LE(pe + 4) !== 0x8664
  )
    throw new Error("invalid x64 PE");
  return validateManifest(JSON.parse(readFileSync(`${helper}.json`, "utf8")), {
    sourceSha256: hashFile(join(directory, "windows-launcher.c")),
    protocolSha256: hashFile(join(directory, "protocol.mjs")),
    helperSha256: hashFile(helper),
  });
}
function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--output")
    throw new Error("usage: build.mjs --output <directory>");
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("build unavailable: Windows x64 required");
  const output = resolve(args[1]);
  mkdirSync(output, { recursive: true });
  const helper = join(output, "windows-launcher.exe");
  rmSync(`${helper}.json`, { force: true });
  rmSync(helper, { force: true });
  rmSync(join(output, "qualified.json"), { force: true });
  const compiler = join(
    process.env.VCToolsInstallDir || "",
    "bin",
    "Hostx64",
    "x64",
    "cl.exe",
  );
  const version = spawnSync(compiler, [], {
    shell: false,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 16384,
  });
  const compilerVersion =
    `${version.stdout || ""}${version.stderr || ""}`.match(
      /19\.(?:3\d|4\d)\.\d+/,
    )?.[0];
  const sdkVersion = process.env.WindowsSDKVersion?.replace(/[\\/]+$/, "");
  const plan = planBuild({
    platform: process.platform,
    arch: process.arch,
    output,
    compiler,
    compilerVersion,
    sdkVersion,
  });
  const result = spawnSync(plan.executable, plan.argv, {
    cwd: output,
    shell: false,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 65536,
  });
  // Compiler output may contain host paths; retain a bounded local build log only.
  writeFileSync(
    join(output, "build.log"),
    `${result.stdout || ""}${result.stderr || ""}`.slice(0, 65536),
  );
  if (result.error || result.status !== 0)
    throw new Error("native compilation failed; see build.log");
  const manifest = {
    version: 1,
    recipe: 1,
    arch: "x64",
    compilerVersion,
    sdkVersion,
    compilerSha256: hashFile(compiler),
    sourceSha256: hashFile(join(directory, "windows-launcher.c")),
    protocolSha256: hashFile(join(directory, "protocol.mjs")),
    helperSha256: hashFile(helper),
  };
  writeFileSync(`${helper}.json`, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  try {
    verifyHelper(helper);
  } catch (error) {
    rmSync(`${helper}.json`, { force: true });
    throw error;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch {
    console.error(
      "host prototype build unavailable or failed (explicit Windows x64 MSVC environment required)",
    );
    process.exitCode = 1;
  }
}
