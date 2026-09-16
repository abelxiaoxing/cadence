import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { syncDirectory } from "./directory-sync.ts";

const prefix = ".cadence-execution-";
const active = new Set<string>();
const retained = new Map<string, readonly string[]>();
/** Written before launching a host process. Absence of a settlement receipt
 * survives host loss; reopening must not infer ownership from a recycled PID. */
export function retainExecution(ownerRoot: string, roots: readonly string[]) {
  assertExecutionsSettled(ownerRoot);
  const file = path.join(ownerRoot, `${prefix}${randomUUID()}.json`);
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        version: 1,
        roots: roots.map((root) => path.resolve(root)),
      }),
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(ownerRoot);
  active.add(file);
  retained.set(file, roots);
  return {
    settled() {
      unlinkSync(file);
      syncDirectory(ownerRoot);
      active.delete(file);
      retained.delete(file);
    },
    uncertain() {
      active.delete(file);
    },
  };
}
export function assertExecutionsSettled(
  ownerRoot: string,
  includeActive = false,
): void {
  if (!lstatSync(ownerRoot, { throwIfNoEntry: false })) return;
  if (
    readdirSync(ownerRoot).some(
      (name) =>
        name.startsWith(prefix) &&
        (includeActive || !active.has(path.join(ownerRoot, name))),
    )
  )
    throw new Error("isolation-termination-unconfirmed");
}
export function isExecutionRetained(root: string): boolean {
  const resolved = path.resolve(root);
  return [...retained.values()].some((roots) =>
    roots.some((candidate) => {
      const relative = path.relative(resolved, path.resolve(candidate));
      return (
        relative === "" ||
        (relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative))
      );
    }),
  );
}
