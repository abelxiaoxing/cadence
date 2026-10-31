import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { researchTools } from "../src/research-tools.mjs";

const deferred = vi.hoisted(() => ({ directory: undefined }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original();
  return {
    ...fs,
    opendir: (...args) => deferred.directory ?? fs.opendir(...args),
  };
});
it("timeout/cancel cannot report completion or close a directory before its original read settles", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-settle-"));
  let started, release;
  const reading = new Promise((r) => {
    started = r;
  });
  const close = vi.fn(async () => {});
  deferred.directory = {
    read: () => {
      started();
      return new Promise((r) => {
        release = r;
      });
    },
    close,
  };
  let now = 0,
    settled = false;
  const abort = new AbortController();
  const tools = researchTools(
    root,
    [root],
    { timeoutMs: 1200000, deadlineMs: 1200000 },
    () => now,
  );
  const original = tools
    .find((t) => t.name === "ls")
    .execute("id", {}, abort.signal);
  const observed = original
    .catch((e) => e)
    .finally(() => {
      settled = true;
    });
  await reading;
  now = 1200000;
  abort.abort();
  await new Promise((r) => setImmediate(r));
  expect(settled).toBe(false);
  expect(close).not.toHaveBeenCalled();
  release(null);
  expect((await observed).message).toContain("canceled");
  expect(close).toHaveBeenCalledTimes(1);
  deferred.directory = undefined;
});
