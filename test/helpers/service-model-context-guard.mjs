// Test-only transport/process guard. No fetch/dispatcher/TLS substitution.
import cp from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

let violations = 0;
function refuse() {
  violations++;
  throw new Error("model-context-fixture-boundary");
}
process.on("exit", () => {
  if (violations) process.exitCode = 91;
});
// Only the fresh fixture is writable/readable data. Module loading may read
// the trusted bundle/installed peer closure, never an actual user's config.
// These public Node API guards are fixture controls, not an OS sandbox.
const realpath = fs.realpathSync;
const root = realpath(process.argv.at(-1));
const bundle = realpath(dirname(process.argv[1]));
const peers = realpath(join(bundle, "node_modules"));
const within = (base, path) => {
  const tail = relative(base, path);
  return !isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${sep}`);
};
const checkedPath = (input, write) => {
  if (typeof input === "number") return; // Previously checked open descriptor.
  const path = resolve(
    input instanceof URL ? fileURLToPath(input) : String(input),
  );
  let canonical;
  try {
    canonical = realpath(path);
  } catch {
    // Missing files still require an owned canonical parent, no alias escape.
    let parent = dirname(path);
    while (true) {
      try {
        canonical = join(realpath(parent), relative(parent, path));
        break;
      } catch {
        if (parent === dirname(parent)) refuse();
        parent = dirname(parent);
      }
    }
  }
  if (
    !within(root, canonical) &&
    (write || ![bundle, peers].some((base) => within(base, canonical)))
  )
    refuse();
};
const writing = (flags) =>
  typeof flags === "number"
    ? (flags &
        (fs.constants.O_WRONLY |
          fs.constants.O_RDWR |
          fs.constants.O_CREAT |
          fs.constants.O_TRUNC |
          fs.constants.O_APPEND)) !==
      0
    : /[wa+]/.test(flags ?? "r");
for (const target of [fs, fsp]) {
  for (const name of [
    "readFile",
    "readFileSync",
    "open",
    "openSync",
    "writeFile",
    "writeFileSync",
    "appendFile",
    "appendFileSync",
  ]) {
    const original = target[name];
    if (!original) continue;
    target[name] = function (path, ...args) {
      checkedPath(
        path,
        name.startsWith("write") ||
          name.startsWith("append") ||
          (name.startsWith("open") && writing(args[0])),
      );
      return original.call(this, path, ...args);
    };
  }
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === "object" ? options.host : args[1];
  const port = typeof options === "object" ? options.port : args[0];
  const ports = (process.env.CADENCE_FIXTURE_PORTS ?? "").split(",");
  if (host !== "127.0.0.1" || !ports.includes(String(port))) refuse();
  return connect.apply(this, args);
};
for (const key of ["resolve", "resolve4", "resolve6"]) dns[key] = refuse;
const lookup = dns.lookup;
dns.lookup = function (host, ...args) {
  if (host !== "127.0.0.1") refuse();
  return lookup.call(this, host, ...args);
};
for (const key of ["exec", "execSync", "execFile", "execFileSync", "fork"])
  cp[key] = refuse;
const spawnSync = cp.spawnSync;
cp.spawnSync = function (executable, args, options) {
  if (
    executable !== "git" ||
    JSON.stringify(args) !== '["rev-parse","--show-toplevel"]'
  )
    refuse();
  return spawnSync.call(this, executable, args, options);
};
const spawn = cp.spawn;
cp.spawn = function (executable, args, options) {
  if (
    executable !== process.execPath ||
    !args?.[0]?.endsWith("service-model-auth-competitor.mjs")
  )
    refuse();
  return spawn.call(
    this,
    executable,
    ["--import", import.meta.url, ...args],
    options,
  );
};
syncBuiltinESMExports();
