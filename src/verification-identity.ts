import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
} from "node:fs";
import path from "node:path";

/** Content identity, including executable modes and links. Never follows dependency links. */
export function verificationEnvironmentDigest(
  roots: readonly string[],
  checkCancelled: () => void = () => {},
) {
  const digest = createHash("sha256");
  let entries = 0;
  let bytes = 0;
  const started = Date.now();
  const buffer = Buffer.alloc(256 * 1024);
  const visit = (file: string, relative: string, dependencyRoot: boolean) => {
    checkCancelled();
    if (++entries > 500_000 || Date.now() - started > 60_000)
      throw new Error("verification-environment-limit");
    const stat = lstatSync(file, { throwIfNoEntry: false });
    digest.update(JSON.stringify([relative, stat ? stat.mode & 0o777 : null]));
    if (!stat) {
      digest.update("absent");
      return;
    }
    if (stat.isSymbolicLink()) {
      digest.update(JSON.stringify(["link", readlinkSync(file)]));
      return;
    }
    if (stat.isDirectory()) {
      digest.update("directory");
      for (const name of readdirSync(file).sort()) {
        if (dependencyRoot && [".vite", ".vite-temp"].includes(name)) continue;
        visit(path.join(file, name), `${relative}/${name}`, false);
      }
      return;
    }
    if (!stat.isFile()) throw new Error("verification-environment-unsafe");
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd);
      if (before.ino !== stat.ino || before.dev !== stat.dev)
        throw new Error("verification-environment-changed");
      const content = createHash("sha256");
      for (;;) {
        const count = readSync(fd, buffer, 0, buffer.length, null);
        if (count === 0) break;
        checkCancelled();
        bytes += count;
        if (bytes > 16 * 1024 ** 3 || Date.now() - started > 60_000)
          throw new Error("verification-environment-limit");
        content.update(buffer.subarray(0, count));
      }
      const after = fstatSync(fd);
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new Error("verification-environment-changed");
      digest.update(JSON.stringify(["file", content.digest("hex")]));
    } finally {
      closeSync(fd);
    }
  };
  for (const root of [...new Set(roots)].sort())
    visit(root, root, path.basename(root) === "node_modules");
  return digest.digest("hex");
}
