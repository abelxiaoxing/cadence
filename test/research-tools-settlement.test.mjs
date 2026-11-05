import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RESEARCH_LIMITS as L } from "../src/research-scan.mjs";
import { createResearchTools } from "../src/research-tools.mjs";
import { bindWorkerWorkspace } from "../src/worker-workspace.mjs";

const seam = vi.hoisted(() => ({
  directory: undefined,
  file: undefined,
  resolved: undefined,
  metadata: undefined,
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original();
  return {
    ...fs,
    opendir: (...args) => seam.directory ?? fs.opendir(...args),
    realpath: async (...args) => {
      const path = await fs.realpath(...args);
      await seam.resolved?.();
      return path;
    },
    lstat: (...args) => {
      seam.metadata?.();
      return fs.lstat(...args);
    },
    open: async (...args) => {
      const file = await fs.open(...args);
      return seam.file ? seam.file(file) : file;
    },
  };
});
afterEach(() => {
  seam.directory = undefined;
  seam.file = undefined;
  seam.resolved = undefined;
  seam.metadata = undefined;
  vi.useRealTimers();
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
it("cancel during canonical-path resolution cannot start the next metadata operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-path-cancel-"));
  const started = deferred(),
    release = deferred();
  let resolutions = 0;
  seam.resolved = async () => {
    if (++resolutions === 2) {
      started.resolve();
      await release.promise;
    }
  };
  seam.metadata = vi.fn();
  const abort = new AbortController();
  const session = createResearchTools(bindWorkerWorkspace(root));
  const observed = session.tools
    .find((t) => t.name === "ls")
    .execute("id", {}, abort.signal)
    .catch((e) => e);
  await started.promise;
  abort.abort();
  release.resolve();
  expect((await observed).message).toContain("canceled");
  expect(seam.metadata).not.toHaveBeenCalled();
  await session.close();
});
it.each(["cancel", "close", "time"])(
  "%s does not release an outstanding directory read or pretend it has settled",
  async (cause) => {
    const root = await mkdtemp(join(tmpdir(), "research-settle-"));
    const started = deferred(),
      release = deferred();
    const close = vi.fn(async () => {});
    seam.directory = {
      read: () => {
        started.resolve();
        return release.promise;
      },
      close,
    };
    let now = 0,
      settled = false;
    const abort = new AbortController();
    const session = createResearchTools(bindWorkerWorkspace(root), () => now);
    const original = session.tools
      .find((t) => t.name === "ls")
      .execute("id", {}, abort.signal);
    const observed = original
      .catch((e) => e)
      .finally(() => {
        settled = true;
      });
    await started.promise;
    let closing;
    if (cause === "cancel") abort.abort();
    if (cause === "close") closing = session.close();
    if (cause === "time") now = L.toolMs + 1;
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false);
    expect(close).not.toHaveBeenCalled();
    release.resolve(null);
    const result = await observed;
    if (cause === "time") expect(result.details.state).toBe("done");
    else expect(result.message).toContain("canceled");
    await closing;
    await session.close();
    expect(close).toHaveBeenCalledTimes(1);
  },
);
it("close joins the actual file read and close, even after the caller canceled", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-file-settle-"));
  await writeFile(join(root, "a"), "evidence");
  const started = deferred(),
    read = deferred(),
    closing = deferred(),
    closed = deferred();
  const close = vi.fn();
  seam.file = (file) => ({
    stat: (...args) => file.stat(...args),
    read: async (...args) => {
      started.resolve();
      await read.promise;
      return file.read(...args);
    },
    close: async () => {
      close();
      closing.resolve();
      await closed.promise;
      await file.close();
    },
  });
  const session = createResearchTools(bindWorkerWorkspace(root));
  const abort = new AbortController();
  const observed = session.tools
    .find((t) => t.name === "read")
    .execute("id", { path: "a" }, abort.signal)
    .catch((e) => e);
  await started.promise;
  abort.abort();
  let settled = false;
  const finish = session.close().then(() => {
    settled = true;
  });
  await new Promise((r) => setImmediate(r));
  expect(close).not.toHaveBeenCalled();
  expect(settled).toBe(false);
  read.resolve();
  await closing.promise;
  expect(settled).toBe(false);
  closed.resolve();
  expect((await observed).message).toContain("canceled");
  await finish;
  expect(close).toHaveBeenCalledTimes(1);
});
it("directory continuation advances a real handle beyond the entry quantum and does not re-open or skip lookahead", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-dir-pages-"));
  let position = 0;
  const close = vi.fn(async () => {});
  seam.directory = {
    read: vi.fn(async () =>
      position < L.entries + 7
        ? {
            name: `${position++}.txt`,
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          }
        : null,
    ),
    close,
  };
  const session = createResearchTools(bindWorkerWorkspace(root));
  const tool = session.tools.find((t) => t.name === "find");
  let result = await tool.execute("id", { pattern: "*.ts" });
  expect(result.details.state).toBe("more");
  expect(result.details.progress.inspectedEntries).toBe(L.entries);
  expect(position).toBe(L.entries);
  expect(close).not.toHaveBeenCalled();
  result = await tool.execute("id", { cursor: result.details.nextCursor });
  expect(result.details.state).toBe("done");
  expect(result.details.progress.total.inspectedEntries).toBe(L.entries + 7);
  expect(seam.directory.read).toHaveBeenCalledTimes(L.entries + 8);
  expect(close).toHaveBeenCalledTimes(1);
  await session.close();
});
it("an idle-expiry close keeps its capacity reservation until closure actually settles", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const root = await mkdtemp(join(tmpdir(), "research-expiry-"));
  const release = deferred();
  const close = vi.fn(() => release.promise);
  const entry = {
    name: "a",
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
  };
  seam.directory = { read: async () => entry, close };
  const session = createResearchTools(bindWorkerWorkspace(root));
  const tool = session.tools.find((t) => t.name === "ls");
  for (let i = 0; i < L.scans; i++) await tool.execute("id", { pageSize: 1 });
  await vi.advanceTimersByTimeAsync(L.idleMs);
  expect(close).toHaveBeenCalledTimes(L.scans);
  await expect(tool.execute("id", {})).rejects.toThrow("capacity");
  let settled = false;
  const closing = session.close().then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  release.resolve();
  await closing;
});
it("failed directory closure cannot become a harmless omission or successful cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-close-failed-"));
  seam.directory = {
    read: async () => null,
    close: async () => {
      throw new Error("synthetic close failure");
    },
  };
  const session = createResearchTools(bindWorkerWorkspace(root));
  const tool = session.tools.find((t) => t.name === "ls");
  await expect(tool.execute("id", {})).rejects.toThrow("closure failed");
  await expect(session.close()).rejects.toThrow("closure failed");
  await expect(tool.execute("id", {})).rejects.toThrow("closure failed");
});
