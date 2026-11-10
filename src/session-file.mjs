/** The one change a Cadence child makes to a Pi session file before Pi opens it
 * to append, shared by the SDK worker and the rename child. */
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  writeSync,
} from "node:fs";

/** A torn final line (a writer killed mid-line) would swallow the next entry. */
export function terminateLastLine(file) {
  const fd = openSync(
    file,
    constants.O_RDWR | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    if (size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10)
      writeSync(fd, "\n");
  } finally {
    closeSync(fd);
  }
}
