import { spawn } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { observeSafePath } from "./safe-path.ts";

export function runGitApply(
  root: string,
  diff: Uint8Array,
  checkOnly: boolean,
  signal: AbortSignal,
): Promise<"ok" | "failed" | "cancelled"> {
  if (signal.aborted) return Promise.resolve("cancelled");
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: "ok" | "failed" | "cancelled") => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      resolve(value);
    };
    const child = spawn(
      "git",
      [
        // Candidate patches bind exact bytes, independent of host checkout
        // preferences. Git's Windows autocrlf default must not rewrite them.
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.eol=lf",
        "apply",
        ...(checkOnly ? ["--check"] : []),
        "--recount",
        "--whitespace=nowarn",
        "-",
      ],
      { cwd: root, shell: false, stdio: ["pipe", "ignore", "ignore"] },
    );
    const abort = () => {
      child.kill("SIGTERM");
      settle("cancelled");
    };
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", () => settle(signal.aborted ? "cancelled" : "failed"));
    child.once("close", (code) =>
      settle(signal.aborted ? "cancelled" : code === 0 ? "ok" : "failed"),
    );
    child.stdin.on("error", () => undefined);
    child.stdin.end(Buffer.from(diff));
  });
}
export function revisionChanges(
  root: string,
  paths: readonly string[],
): Record<
  string,
  { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
> {
  const changes: Record<
    string,
    { kind: "absent" } | { kind: "file"; bytes: Uint8Array; mode: number }
  > = {};
  for (const relative of [...new Set(paths)].sort()) {
    const observation = observeSafePath(root, relative);
    if (observation.kind === "absent") {
      changes[relative] = { kind: "absent" };
      continue;
    }
    if (observation.kind !== "file") {
      throw new Error("workflow-candidate-path-unsafe");
    }
    const target = path.join(root, ...relative.split("/"));
    const stat = lstatSync(target);
    changes[relative] = {
      kind: "file",
      bytes: readFileSync(target),
      mode: stat.mode & 0o777,
    };
  }
  return changes;
}
