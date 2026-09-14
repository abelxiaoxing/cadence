import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { syncDirectory } from "./directory-sync.ts";

const SHA256 = /^[a-f0-9]{64}$/u;

export interface ArtifactIdentity {
  hash: string;
  bytes: number;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireHash(hash: string): void {
  if (!SHA256.test(hash)) throw new Error("artifact-hash-invalid");
}

function ensureDirectory(directory: string): void {
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("artifact-store-path-unsafe");
    }
    chmodSync(directory, 0o700);
    return;
  }
  let cursor = path.dirname(directory);
  while (cursor !== path.dirname(cursor)) {
    const ancestor = lstatSync(cursor, { throwIfNoEntry: false });
    if (ancestor) {
      if (ancestor.isSymbolicLink() || !ancestor.isDirectory()) {
        throw new Error("artifact-store-path-unsafe");
      }
      break;
    }
    cursor = path.dirname(cursor);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const created = lstatSync(directory);
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new Error("artifact-store-path-unsafe");
  }
  chmodSync(directory, 0o700);
}

function writeAtomic(target: string, bytes: Uint8Array): void {
  const directory = path.dirname(target);
  ensureDirectory(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const descriptor = openSync(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, target);
    chmodSync(target, 0o600);
    syncDirectory(directory);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The rename may already have consumed the temporary file.
    }
    throw error;
  }
}

/** Durable content-addressed bytes used by workspace revisions and sealed results. */
export class ArtifactStore {
  readonly root: string;
  readonly #blobs: string;
  readonly #references: string;

  constructor(root: string) {
    if (!path.isAbsolute(root)) throw new Error("artifact-store-root-invalid");
    this.root = path.resolve(root);
    this.#blobs = path.join(this.root, "blobs");
    this.#references = path.join(this.root, "references");
    ensureDirectory(this.root);
    ensureDirectory(this.#blobs);
    ensureDirectory(this.#references);
  }

  #blobPath(hash: string): string {
    requireHash(hash);
    return path.join(this.#blobs, hash.slice(0, 2), hash);
  }

  #referencePath(hash: string): string {
    requireHash(hash);
    return path.join(this.#references, hash.slice(0, 2), `${hash}.ref`);
  }

  put(input: Uint8Array): ArtifactIdentity {
    if (!(input instanceof Uint8Array))
      throw new Error("artifact-bytes-invalid");
    const bytes = Buffer.from(input);
    const hash = digest(bytes);
    const target = this.#blobPath(hash);
    const existing = lstatSync(target, { throwIfNoEntry: false });
    if (existing) {
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new Error("artifact-store-path-unsafe");
      }
      const current = readFileSync(target);
      if (current.length !== bytes.length || digest(current) !== hash) {
        throw new Error("artifact-integrity-invalid");
      }
    } else {
      writeAtomic(target, bytes);
      const stored = readFileSync(target);
      if (stored.length !== bytes.length || digest(stored) !== hash) {
        throw new Error("artifact-integrity-invalid");
      }
    }
    return Object.freeze({ hash, bytes: bytes.length });
  }

  read(hash: string): Uint8Array {
    const target = this.#blobPath(hash);
    const stat = lstatSync(target, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      throw new Error("artifact-unavailable");
    }
    const bytes = readFileSync(target);
    if (digest(bytes) !== hash) throw new Error("artifact-integrity-invalid");
    return Buffer.from(bytes);
  }

  /** Clone when supported; always use a distinct inode and verify the copied bytes. */
  copyVerified(hash: string, destination: string): number {
    const source = this.#blobPath(hash);
    const stat = lstatSync(source, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink())
      throw new Error("artifact-unavailable");
    copyFileSync(
      source,
      destination,
      constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE,
    );
    const bytes = readFileSync(destination);
    if (digest(bytes) !== hash) throw new Error("artifact-integrity-invalid");
    return bytes.byteLength;
  }

  referenceCount(hash: string): number {
    requireHash(hash);
    const referencePath = this.#referencePath(hash);
    const stat = lstatSync(referencePath, { throwIfNoEntry: false });
    if (!stat) return 0;
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("artifact-reference-invalid");
    }
    const raw = readFileSync(referencePath, "utf8");
    if (!/^(?:0|[1-9][0-9]*)\n$/u.test(raw)) {
      throw new Error("artifact-reference-invalid");
    }
    const count = Number(raw.trim());
    if (!Number.isSafeInteger(count))
      throw new Error("artifact-reference-invalid");
    return count;
  }

  #setReferenceCount(hash: string, count: number): number {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("artifact-reference-invalid");
    }
    writeAtomic(this.#referencePath(hash), Buffer.from(`${count}\n`));
    return count;
  }

  retain(hash: string): number {
    this.read(hash);
    const current = this.referenceCount(hash);
    if (current === Number.MAX_SAFE_INTEGER) {
      throw new Error("artifact-reference-overflow");
    }
    return this.#setReferenceCount(hash, current + 1);
  }

  release(hash: string): number {
    this.read(hash);
    const current = this.referenceCount(hash);
    if (current === 0) throw new Error("artifact-reference-underflow");
    return this.#setReferenceCount(hash, current - 1);
  }
}
