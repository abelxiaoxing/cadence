import { closeSync, constants, fstatSync, fsyncSync, openSync } from "node:fs";

/**
 * Flush a published directory entry where Node supports it. Windows rejects
 * FlushFileBuffers on Node's read-only directory handle with EPERM. This is
 * specifically a missing directory barrier, NOT permission to ignore file
 * flush, open, close, rename or other I/O errors.
 *
 * Callers must flush file bytes before publishing and retain their integrity
 * checks / write-ahead recovery records. On Windows this provides process-crash
 * recovery, not a POSIX directory-fsync guarantee across sudden power loss.
 */
export function syncDirectory(
  directory: string,
): "synced" | "unsupported-directory-barrier" {
  const descriptor = openSync(directory, constants.O_RDONLY);
  try {
    try {
      fsyncSync(descriptor);
      return "synced";
    } catch (error) {
      const failure = error as NodeJS.ErrnoException | null;
      if (
        process.platform === "win32" &&
        failure?.code === "EPERM" &&
        failure.syscall === "fsync" &&
        fstatSync(descriptor).isDirectory()
      ) {
        return "unsupported-directory-barrier";
      }
      throw error;
    }
  } finally {
    closeSync(descriptor);
  }
}
