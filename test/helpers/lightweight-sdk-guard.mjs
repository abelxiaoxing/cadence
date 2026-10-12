// Test-only preload: forbid discovery/state writes/installation and non-loopback network.

import cp from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import path from "node:path";

const cwd = process.cwd();
let violations = 0;
function refuse(message) {
  violations++;
  throw new Error(message);
}
process.on("exit", () => {
  if (violations) process.exitCode = 91;
});
const forbidden = (p) =>
  typeof p === "string" &&
  /(^|[/\\])(?:(auth|settings|models|models-store)\.json|AGENTS(?:\.override)?\.md|CLAUDE\.md)$|[/\\]\.pi[/\\]|[/\\]\.agents[/\\]/.test(
    p,
  );
for (const object of [fs, fsp]) {
  for (const key of [
    "open",
    "openSync",
    "readFile",
    "readFileSync",
    "readdir",
    "readdirSync",
    "opendir",
    "opendirSync",
    "access",
    "accessSync",
    "stat",
    "statSync",
    "lstat",
    "lstatSync",
    "existsSync",
  ]) {
    if (typeof object[key] !== "function") continue;
    const original = object[key];
    object[key] = function (p, ...args) {
      if (forbidden(p)) refuse("Fixture: discovery/state access forbidden");
      return original.call(this, p, ...args);
    };
  }
  for (const key of [
    "writeFile",
    "writeFileSync",
    "appendFile",
    "appendFileSync",
    "mkdir",
    "mkdirSync",
    "rename",
    "renameSync",
    "unlink",
    "unlinkSync",
    "rm",
    "rmSync",
  ]) {
    if (typeof object[key] !== "function") continue;
    const original = object[key];
    object[key] = function (p, ...args) {
      const target = typeof p === "string" ? path.resolve(p) : "";
      if (
        !(target === cwd && key.startsWith("mkdir")) &&
        !(
          target === path.join(cwd, "fixture.txt") &&
          key.startsWith("writeFile")
        )
      )
        refuse("Fixture: non-tool write forbidden");
      return original.call(this, p, ...args);
    };
  }
}
for (const key of [
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
])
  cp[key] = () => {
    refuse("Fixture: subprocess/install forbidden");
  };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === "object" ? options.host : args[1];
  if (host !== "127.0.0.1")
    refuse("Fixture: non-loopback connection forbidden");
  return connect.apply(this, args);
};
for (const key of ["lookup", "resolve", "resolve4", "resolve6"])
  dns[key] = () => {
    refuse("Fixture: DNS forbidden");
  };
syncBuiltinESMExports();
