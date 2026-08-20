// File-level snapshots: content hashes for observed files, deterministic
// recursive content manifests for observed directories, and explicit absent
// markers for proposed new paths. Currency is decided per bound path; no
// global workspace revision participates.
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

export interface FileBound {
  kind: "file";
  sha256: string;
  bytes: number;
}

export interface DirBound {
  kind: "dir";
  manifest: string;
}

export interface AbsentBound {
  kind: "absent";
  absent: true;
}

export type Bound = Record<string, FileBound | DirBound | AbsentBound>;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Snapshot one existing regular file under root. */
export function snapshotFile(root: string, relPath: string): FileBound | null {
  const abs = resolve(root, relPath);
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st?.isFile()) return null;
  const bytes = readFileSync(abs);
  return { sha256: sha256(bytes), bytes: bytes.length, kind: "file" };
}

function updateManifest(
  hash: ReturnType<typeof createHash>,
  ...fields: Array<string | Buffer>
): void {
  for (const field of fields) {
    const bytes = typeof field === "string" ? Buffer.from(field) : field;
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  }
}

function recursiveDirectoryManifest(abs: string): string {
  const hash = createHash("sha256");
  updateManifest(hash, "cadence-directory-manifest-v2");
  const visit = (directory: string, prefix: string): void => {
    const names = readdirSync(directory).sort();
    for (const name of names) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const current = join(directory, name);
      const stat = lstatSync(current);
      if (stat.isDirectory()) {
        updateManifest(hash, "dir", relative, String(stat.mode & 0o777));
        visit(current, relative);
      } else if (stat.isFile()) {
        const bytes = readFileSync(current);
        updateManifest(
          hash,
          "file",
          relative,
          String(stat.mode & 0o777),
          String(bytes.length),
          sha256(bytes),
        );
      } else if (stat.isSymbolicLink()) {
        updateManifest(hash, "symlink", relative, readlinkSync(current));
      } else {
        updateManifest(
          hash,
          "special",
          relative,
          String(stat.mode),
          String(stat.size),
        );
      }
    }
  };
  visit(abs, "");
  return hash.digest("hex");
}

/** Deterministic recursive directory manifest bound to installed content. */
export function snapshotDirManifest(
  root: string,
  relDir: string,
): DirBound | null {
  const abs = resolve(root, relDir);
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st?.isDirectory()) return null;
  return { manifest: recursiveDirectoryManifest(abs), kind: "dir" };
}

/** Build a bound map for the given file paths, observed directories, and absent markers. */
export function snapshotFiles(
  root: string,
  files: string[],
  opts: { absent?: string[] } = {},
): Bound {
  const bound: Bound = {};
  for (const p of [...new Set(files)]) {
    const entry = snapshotFile(root, p);
    if (entry) bound[p] = entry;
    else bound[p] = { kind: "absent", absent: true };
  }
  for (const p of opts.absent ?? [])
    bound[p] = { kind: "absent", absent: true };
  return bound;
}

/** Build a bound map for observed directories (deterministic manifests). */
export function snapshotDirManifests(root: string, dirs: string[]): Bound {
  const bound: Bound = {};
  for (const p of [...new Set(dirs)]) {
    const entry = snapshotDirManifest(root, p);
    if (entry) bound[p] = entry;
    else bound[p] = { kind: "absent", absent: true };
  }
  return bound;
}

/** Recapture each bound path and report whether the bound state is current. */
export function isCurrent(root: string, bound: Bound): boolean {
  for (const [rel, expected] of Object.entries(bound)) {
    if (expected.kind === "dir") {
      const now = snapshotDirManifest(root, rel);
      if (!now || now.manifest !== expected.manifest) return false;
      continue;
    }
    const abs = resolve(root, rel);
    const exists = existsSync(abs);
    if (expected.kind === "file") {
      if (!exists) return false;
      const st = statSync(abs);
      if (!st.isFile()) return false;
      const now = snapshotFile(root, rel);
      if (
        !now ||
        now.sha256 !== expected.sha256 ||
        now.bytes !== expected.bytes
      )
        return false;
    } else if (expected.absent) {
      if (exists) return false;
    }
  }
  return true;
}

/** Merge bound maps (read observations + write targets). */
export function mergeBounds(...bounds: Bound[]): Bound {
  return Object.assign({}, ...bounds);
}
