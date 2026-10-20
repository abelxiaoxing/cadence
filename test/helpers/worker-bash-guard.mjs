// Native bash qualification only: preserve the ordinary SDK guard except for
// one exact fixed read-only shell command. No install/general shell allowance.
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const spawn = cp.spawn;
await import("./lightweight-sdk-guard.mjs");
const refused = cp.spawn;
cp.spawn = function (command, args, options) {
  if (
    ["/bin/bash", "/usr/bin/bash"].includes(command) &&
    args.length === 2 &&
    args[0] === "-c" &&
    [
      "printf '\\377'",
      "printf 'fabricated-capture-canary'; i=0; while [ \"$i\" -lt 4096 ]; do printf 'bash-public-output\\n'; i=$((i+1)); done",
    ].includes(args[1]) &&
    options.cwd === process.cwd()
  )
    return spawn.call(this, command, args, options);
  return refused.call(this, command, args, options);
};
syncBuiltinESMExports();
