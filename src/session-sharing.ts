/** Tells a terminal user when the browser continued the session Pi has open.
 * Pi holds its own copy of an open session, so the browser's messages appear
 * here only after the session is resumed again, and a message sent here first
 * continues from where the terminal is, as a new branch. Readonly: it never
 * writes the session or reloads it. */
import {
  closeSync,
  constants,
  type FSWatcher,
  fstatSync,
  openSync,
  readSync,
  watch,
} from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const CONTINUED_ELSEWHERE =
  "This session was continued in the Cadence WebUI. Run /resume and choose it again to see those messages; a message sent here first starts a new branch from where this terminal is.";

export function registerSessionSharing(pi: ExtensionAPI): void {
  let current: ExtensionContext | undefined;
  let watcher: FSWatcher | undefined;
  let file: string | undefined;
  let offset = 0,
    foreign = 0,
    told = 0;
  const reset = () => {
    watcher?.close();
    watcher = undefined;
    file = undefined;
    offset = 0;
    foreign = 0;
    told = 0;
  };
  const check = () => {
    try {
      observe();
    } catch {
      // A notice only: an unexpected context never fails Pi's own event.
    }
  };
  const observe = () => {
    const ctx = current;
    const path =
      typeof ctx?.sessionManager?.getSessionFile === "function"
        ? ctx.sessionManager.getSessionFile()
        : undefined;
    if (!ctx || !path) return;
    if (path !== file) {
      reset();
      file = path;
      try {
        watcher = watch(path, { persistent: false }, () => check());
        watcher.on("error", () => {
          watcher?.close();
          watcher = undefined;
        });
      } catch {
        // Pi writes a new session only after its first reply; checked again then.
      }
    }
    let fd: number | undefined;
    try {
      fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const size = fstatSync(fd).size;
      if (size < offset) offset = 0;
      if (size === offset) return;
      const buffer = Buffer.alloc(size - offset);
      const read = readSync(fd, buffer, 0, buffer.length, offset);
      const end = buffer.subarray(0, read).lastIndexOf(10);
      if (end < 0) return;
      for (const line of buffer.subarray(0, end).toString("utf8").split("\n"))
        try {
          const entry: unknown = JSON.parse(line);
          const o =
            entry && typeof entry === "object"
              ? (entry as Record<string, unknown>)
              : {};
          if (
            o.type !== "session" &&
            typeof o.id === "string" &&
            !ctx.sessionManager.getEntry(o.id)
          )
            foreign++;
        } catch {
          // A torn or foreign line is not this session's entry.
        }
      offset += end + 1;
    } catch {
      return;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    if (foreign > told && ctx.hasUI) {
      told = foreign;
      ctx.ui.notify(CONTINUED_ELSEWHERE, "warning");
    }
  };
  pi.on("session_start", (_event, ctx) => {
    current = ctx;
    reset();
    check();
  });
  pi.on("before_agent_start", (_event, ctx) => {
    current = ctx;
    check();
    return undefined;
  });
  pi.on("agent_settled", (_event, ctx) => {
    current = ctx;
    check();
  });
  pi.on("session_shutdown", () => {
    reset();
    current = undefined;
  });
}
