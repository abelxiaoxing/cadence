/** Bounded readonly files and directory discovery. No Git filters or shell route. */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalAmbientRoot, safeDirectory } from "../task-store.ts";
import { sanitizeText, TextSanitizer } from "../worker-redaction.mjs";
import { ContractError } from "./contracts/core.ts";
import type { FileEntry, WorkbenchResult } from "./contracts/workbench.ts";

export function inside(root: string, path: string): boolean {
  const r = relative(root, path);
  return (
    r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`))
  );
}
const sensitive = (name: string) =>
  /^\.(?:git|ssh|aws|azure|gnupg|kube|npmrc|pypirc|netrc)$/i.test(name) ||
  /^\.env(?:\.|$)/i.test(name) ||
  /^(?:auth|models|credentials|service-account)\.json$/i.test(name) ||
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i.test(name) ||
  /\.(?:pem|key|p12|pfx)$/i.test(name);
export class WorkbenchFiles {
  readonly root: string;
  private readonly excluded: readonly string[];
  constructor(
    root: string,
    excluded: readonly string[],
    private readonly secrets: () => readonly string[],
  ) {
    this.root = realpathSync(root);
    // Pi's configured agent directory may be a dotfiles alias. Exclude its
    // actual target too, without creating a missing directory.
    this.excluded = excluded.flatMap((path) => [
      resolve(path),
      canonicalAmbientRoot(path),
    ]);
  }
  allowed(path: string): void {
    if (
      path.split(/[\\/]/).some(sensitive) ||
      this.excluded.some((root) => inside(root, path))
    )
      throw new ContractError("forbidden");
    const stat = lstatSync(path);
    if (
      stat.isSymbolicLink() ||
      (stat.isFile() && stat.nlink !== 1) ||
      (process.platform !== "win32" &&
        process.getuid &&
        stat.uid !== process.getuid())
    )
      throw new ContractError("forbidden");
  }
  directory(path: string): string {
    if (!isAbsolute(path) || !safeDirectory(path))
      throw new ContractError("invalid");
    const canonical = realpathSync(path);
    this.allowed(canonical);
    return canonical;
  }
  private selected(path: string): string {
    if (
      isAbsolute(path) ||
      path.split(/[\\/]/).some((part) => part === ".." || sensitive(part))
    )
      throw new ContractError("forbidden");
    const target = resolve(this.root, path);
    if (!inside(this.root, target) || !safeDirectory(dirname(target)))
      throw new ContractError("forbidden");
    this.allowed(target);
    if (lstatSync(target).isSymbolicLink())
      throw new ContractError("forbidden");
    return target;
  }
  /** Folder browsing only (Open still requires a full path): `~` names this
   * account's home, and a file or linked component is a refusal, not unreadable. */
  private browsed(path: string): string {
    const full = /^~(?:[\\/]|$)/.test(path)
      ? join(homedir(), path.slice(1))
      : path || this.root;
    try {
      return this.directory(full);
    } catch (error) {
      if (error instanceof Error && error.message === "Unsafe directory")
        throw new ContractError("forbidden");
      throw error;
    }
  }
  list(path: string, directories = false): WorkbenchResult {
    const selected = directories ? this.browsed(path) : this.selected(path);
    if (
      !safeDirectory(selected) ||
      sanitizeText(selected, this.secrets()) !== selected
    )
      throw new ContractError("forbidden");
    const entries: FileEntry[] = [],
      dir = opendirSync(selected);
    let limited = false,
      scanned = 0;
    try {
      for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
        if (++scanned > 2000) {
          limited = true;
          break;
        }
        if (
          sensitive(entry.name) ||
          entry.isSymbolicLink() ||
          (!entry.isFile() && !entry.isDirectory()) ||
          (directories && !entry.isDirectory())
        )
          continue;
        const absolute = join(selected, entry.name);
        try {
          this.allowed(absolute);
        } catch {
          continue;
        }
        const wire = directories
          ? absolute
          : relative(this.root, absolute).split(sep).join("/");
        if (sanitizeText(wire, this.secrets()) !== wire) continue;
        if (entries.length >= 200) {
          limited = true;
          break;
        }
        entries.push({
          name: entry.name,
          path: wire,
          directory: entry.isDirectory(),
        });
      }
    } finally {
      dir.closeSync();
    }
    entries.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    );
    const parent = dirname(selected);
    return {
      kind: directories ? "directories" : "files",
      path: directories ? selected : path,
      parent: directories
        ? parent === selected
          ? null
          : parent
        : selected === this.root
          ? null
          : relative(this.root, parent).split(sep).join("/"),
      entries,
      limited,
    };
  }
  read(path: string): WorkbenchResult {
    const selected = this.selected(path),
      before = lstatSync(selected);
    if (!before.isFile()) throw new ContractError("forbidden");
    const fd = openSync(
      selected,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const opened = fstatSync(fd);
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        before.dev !== opened.dev ||
        before.ino !== opened.ino
      )
        throw new ContractError("stale");
      // Small files only. No unbounded allocation or raw binary/image download.
      const buffer = Buffer.alloc(Math.min(opened.size, 128 * 1024));
      let at = 0;
      while (at < buffer.length) {
        const n = readSync(fd, buffer, at, buffer.length - at, at);
        if (!n) break;
        at += n;
      }
      const after = fstatSync(fd),
        current = lstatSync(selected);
      if (
        after.size !== opened.size ||
        after.mtimeMs !== opened.mtimeMs ||
        after.nlink !== 1 ||
        current.isSymbolicLink() ||
        current.nlink !== 1 ||
        current.ino !== opened.ino ||
        current.dev !== opened.dev
      )
        throw new ContractError("stale");
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        buffer.subarray(0, at),
        { stream: at < opened.size },
      );
      if (decoded.includes("\0"))
        throw new ContractError("unsupported-context");
      return {
        kind: "file",
        path,
        text: new TextSanitizer(this.secrets()).write(
          decoded,
          at === opened.size,
        ),
        limited: at < opened.size,
      };
    } finally {
      closeSync(fd);
    }
  }
}
