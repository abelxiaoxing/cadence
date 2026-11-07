import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkerToolkit } from "../src/worker-toolkit.mjs";
import { bindWorkerWorkspace } from "../src/worker-workspace.mjs";

const seam = vi.hoisted(() => ({ read: undefined }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original();
  return {
    ...fs,
    readFile: (...args) =>
      seam.read ? seam.read(() => fs.readFile(...args)) : fs.readFile(...args),
  };
});
afterEach(() => {
  seam.read = undefined;
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
it.each(["cancel", "close"])(
  "%s joins the actual SDK read rather than an early abort observer",
  async (cause) => {
    const root = await mkdtemp(join(tmpdir(), "pi-observe-settle-"));
    await writeFile(join(root, "a.txt"), "evidence");
    const started = deferred(),
      release = deferred();
    seam.read = async (read) => {
      started.resolve();
      await release.promise;
      return read();
    };
    const kit = createWorkerToolkit({
      purpose: "research",
      workspace: bindWorkerWorkspace(root),
    });
    const read = kit
      .wrap(kit.sessionOptions.customTools)
      .find((tool) => tool.name === "read");
    const abort = new AbortController();
    let settled = false,
      closed = false;
    const result = read
      .execute("read", { path: "a.txt" }, abort.signal)
      .catch((error) => error)
      .finally(() => {
        settled = true;
      });
    await started.promise;
    if (cause === "cancel") abort.abort();
    const closing = kit.close().then(() => {
      closed = true;
    });
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(closed).toBe(false);
      await expect(read.execute("later", { path: "a.txt" })).rejects.toThrow(
        "closed",
      );
    } finally {
      release.resolve();
    }
    const outcome = await result;
    if (cause === "cancel") expect(outcome.message).toContain("canceled");
    else expect(outcome.content[0].text).toBe("evidence");
    await closing;
    expect(settled).toBe(true);
    expect(closed).toBe(true);
  },
);
it("pre-cancel starts no SDK I/O; original failures stay errors, not successful evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-observe-error-"));
  await writeFile(join(root, "a.txt"), "evidence");
  const readFile = vi.fn(async () => {
    throw new Error("fixture read failed");
  });
  seam.read = readFile;
  const kit = createWorkerToolkit({
    purpose: "research",
    workspace: bindWorkerWorkspace(root),
  });
  const tool = kit
    .wrap(kit.sessionOptions.customTools)
    .find((entry) => entry.name === "read");
  try {
    const abort = new AbortController();
    abort.abort();
    await expect(
      tool.execute("canceled", { path: "a.txt" }, abort.signal),
    ).rejects.toThrow("canceled");
    expect(readFile).not.toHaveBeenCalled();
    await expect(tool.execute("failure", { path: "a.txt" })).rejects.toThrow(
      "fixture read failed",
    );
  } finally {
    await kit.close();
  }
});
