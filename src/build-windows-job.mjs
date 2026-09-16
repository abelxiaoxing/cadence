// Explicit operator/release build only. Never invoked on import, install or verification.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function main() {
  const args = process.argv.slice(2);
  if (
    process.platform !== "win32" ||
    process.arch !== "x64" ||
    args.length !== 2 ||
    args[0] !== "--output"
  )
    throw new Error(
      "Windows x64 required; usage: node build-windows-job.mjs --output <directory>",
    );
  const output = path.resolve(args[1]);
  const compiler = path.join(
    process.env.VCToolsInstallDir ?? "",
    "bin/Hostx64/x64/cl.exe",
  );
  if (!path.isAbsolute(compiler))
    throw new Error(
      "Select the installed MSVC x64 developer environment first",
    );
  const sdkVersion = process.env.WindowsSDKVersion?.replace(/[\\/]+$/u, "");
  if (!sdkVersion || !/^10\.0\.\d+\.0$/u.test(sdkVersion))
    throw new Error("Windows 10 SDK required");
  const version = spawnSync(compiler, [], {
    shell: false,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 16384,
  });
  const compilerVersion =
    `${version.stdout ?? ""}${version.stderr ?? ""}`.match(
      /19\.(?:3\d|4\d)\.\d+/u,
    )?.[0];
  if (!compilerVersion) throw new Error("MSVC 19.3x/19.4x required");
  mkdirSync(output, { recursive: true });
  const source = fileURLToPath(new URL("./windows-job.c", import.meta.url));
  const helper = path.join(output, "windows-job.exe");
  rmSync(`${helper}.json`, { force: true });
  rmSync(helper, { force: true });
  const result = spawnSync(
    compiler,
    [
      "/nologo",
      "/W4",
      "/WX",
      "/O2",
      "/MT",
      "/utf-8",
      "/DUNICODE",
      "/D_UNICODE",
      source,
      `/Fe:${helper}`,
      `/Fo:${path.join(output, "windows-job.obj")}`,
    ],
    {
      shell: false,
      cwd: output,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 65536,
    },
  );
  writeFileSync(
    path.join(output, "build.log"),
    `${result.stdout ?? ""}${result.stderr ?? ""}`,
  );
  if (result.error || result.status !== 0)
    throw new Error("Native build failed; inspect build.log");
  const hash = (file) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  writeFileSync(
    `${helper}.json`,
    `${JSON.stringify({ version: 2, arch: "x64", sourceSha256: hash(source), helperSha256: hash(helper), compilerSha256: hash(compiler), compilerVersion, sdkVersion }, null, 2)}\n`,
    { flag: "wx" },
  );
  console.log(`Built ${helper}`);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
