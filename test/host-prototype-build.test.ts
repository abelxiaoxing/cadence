import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const directory = resolve("scripts/host-prototype");
it("[HOST-PREP:build-contract] preparation modules exist before import", async () => {
  for (const file of ["protocol.mjs", "build.mjs", "windows-launcher.c"])
    expect(
      existsSync(`${directory}/${file}`),
      "[HOST-PREP:build-contract]",
    ).toBe(true);
  const protocol = await import(`${directory}/protocol.mjs`);
  const build = await import(`${directory}/build.mjs`);
  const request = {
    version: 1,
    executable: "C:\\Program Files\\node.exe",
    argv: ["中文", "a b", 'a"b', ""],
    cwd: "C:\\temp",
    env: { SystemRoot: "C:\\Windows" },
    timeoutMs: 1000,
    shutdownMs: 500,
    outputLimit: 4096,
  };
  expect(protocol.validateRequest(request, "win32")).toEqual(request);
  for (const override of [
    { mounts: [] },
    { executable: "node" },
    { argv: ["\0"] },
    { cwd: "C:relative" },
    { env: { Path: "a", PATH: "b" } },
    { timeoutMs: Infinity },
    { env: { "bad=key": "x" } },
  ])
    expect(() =>
      protocol.validateRequest({ ...request, ...override }, "win32"),
    ).toThrow();
  expect(protocol.encodeWindowsRequest(request).length).toBeLessThan(65536);
  expect(() => build.planBuild({ platform: "linux", arch: "x64" })).toThrow(
    /unavailable/,
  );
  const input = {
    platform: "win32",
    arch: "x64",
    output: "C:\\out",
    compiler: "C:\\VS\\cl.exe",
    compilerVersion: "19.44.35217",
    sdkVersion: "10.0.26100.0",
  };
  expect(build.planBuild(input).shell).toBe(false);
  expect(() => build.planBuild({ ...input, arch: "arm64" })).toThrow();
  expect(() =>
    build.planBuild({ ...input, compilerVersion: "18.0" }),
  ).toThrow();
  const source = readFileSync(`${directory}/windows-launcher.c`, "utf8");
  // Preparation source assertions are not native lifecycle qualification.
  expect(source).toContain("CREATE_SUSPENDED");
  expect(source.indexOf("AssignProcessToJobObject(job")).toBeLessThan(
    source.indexOf("ResumeThread(pi.hThread)"),
  );
  expect(source).toContain("PROC_THREAD_ATTRIBUTE_HANDLE_LIST");
  expect(source).toContain("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE");
  const manifest = {
    version: 1,
    recipe: 1,
    arch: "x64",
    compilerVersion: input.compilerVersion,
    sdkVersion: input.sdkVersion,
    compilerSha256: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    protocolSha256: "c".repeat(64),
    helperSha256: "d".repeat(64),
  };
  expect(
    build.validateManifest(manifest, {
      sourceSha256: manifest.sourceSha256,
      protocolSha256: manifest.protocolSha256,
      helperSha256: manifest.helperSha256,
    }),
  ).toEqual(manifest);
  expect(() =>
    build.validateManifest(manifest, {
      ...manifest,
      helperSha256: "e".repeat(64),
    }),
  ).toThrow();
});

it("encodes UTF-16 buffers and CRT escaping without shell interpolation", async () => {
  const protocol = await import(`${directory}/protocol.mjs`);
  expect(protocol.quoteWindowsArg("")).toBe('""');
  expect(protocol.quoteWindowsArg('a"b')).toBe('"a\\"b"');
  expect(protocol.quoteWindowsArg("a\\")).toBe('"a\\\\"');
  const request = {
    version: 1,
    executable: "C:\\node.exe",
    argv: ["😀", "中文 space", ""],
    cwd: "C:\\temp",
    env: { SystemRoot: "C:\\Windows", TEMP: "C:\\temp" },
    timeoutMs: 1000,
    shutdownMs: 500,
    outputLimit: 4096,
  };
  const wire = protocol.encodeWindowsRequest(request);
  let offset = 36;
  const decoded = [];
  for (let i = 0; i < 4; i++) {
    const length = wire.readUInt32LE(16 + 4 * i);
    decoded.push(wire.subarray(offset, offset + length).toString("utf16le"));
    offset += length;
  }
  expect(offset).toBe(wire.length);
  expect(decoded[0]).toBe(`${request.executable}\0`);
  expect(decoded[1]).toBe('"C:\\node.exe" "😀" "中文 space" ""\0');
  expect(decoded[3]).toBe("SystemRoot=C:\\Windows\0TEMP=C:\\temp\0\0");
  for (const argv of [["\ud800"], ["x".repeat(16385)], Array(129).fill("a")])
    expect(() => protocol.encodeWindowsRequest({ ...request, argv })).toThrow();
});
