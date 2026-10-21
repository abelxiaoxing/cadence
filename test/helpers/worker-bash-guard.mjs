// Native bash qualification only: preserve the ordinary SDK guard except for
// one exact fixed read-only shell command. No install/general shell allowance.
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const spawn = cp.spawn;
await import("./lightweight-sdk-guard.mjs");
const refused = cp.spawn;
// The shells the SDK itself selects: Git Bash under ProgramFiles on Windows.
const shells =
  process.platform === "win32"
    ? [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
        .filter(Boolean)
        .map((dir) => `${dir}\\Git\\bin\\bash.exe`)
    : ["/bin/bash", "/usr/bin/bash"];
// On Windows the SDK's own abort/timeout path ends a bash child it launched
// with taskkill /F /T; allow exactly that, for children this guard allowed.
const launched = new Set();
cp.spawn = function (command, args, options) {
  if (
    process.platform === "win32" &&
    command === "taskkill" &&
    args.length === 4 &&
    args[0] === "/F" &&
    args[1] === "/T" &&
    args[2] === "/PID" &&
    launched.has(args[3])
  )
    return spawn.call(this, command, args, options);
  if (
    shells.includes(command) &&
    args.length === 2 &&
    args[0] === "-c" &&
    [
      "printf '\\377'",
      "printf 'fabricated-capture-canary'; i=0; while [ \"$i\" -lt 4096 ]; do printf 'bash-public-output\\n'; i=$((i+1)); done",
    ].includes(args[1]) &&
    options.cwd === process.cwd()
  ) {
    const child = spawn.call(this, command, args, options);
    if (child.pid) launched.add(String(child.pid));
    return child;
  }
  return refused.call(this, command, args, options);
};
syncBuiltinESMExports();
