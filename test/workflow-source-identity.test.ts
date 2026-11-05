import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  contentsIdentityAsync,
  sourceIdentityAsync,
} from "../src/service/workflow-git.ts";

it("verification identifies large directory contents across worktrees by bytes, never inode or timestamps", async () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-source-"));
  const candidate = join(root, "candidate"),
    delivered = join(root, "delivered");
  for (const cwd of [candidate, delivered])
    mkdirSync(join(cwd, "src"), { recursive: true });
  const body = Buffer.alloc(1024 * 1024 + 1, "a");
  writeFileSync(join(candidate, "src/asset.txt"), body);
  copyFileSync(
    join(candidate, "src/asset.txt"),
    join(delivered, "src/asset.txt"),
  );
  // Admission/change fences may use placement metadata; verification may not.
  expect(await contentsIdentityAsync(candidate, ["src"])).not.toBe(
    await contentsIdentityAsync(delivered, ["src"]),
  );
  const verified = await sourceIdentityAsync(candidate, ["src"]);
  expect(await sourceIdentityAsync(delivered, ["src"])).toBe(verified);
  body[body.length - 1] = 98;
  writeFileSync(join(delivered, "src/asset.txt"), body);
  expect(await sourceIdentityAsync(delivered, ["src"])).not.toBe(verified);
});

it("source hashing honors cancellation without treating it as a valid observation", async () => {
  const root = mkdtempSync(join(tmpdir(), "workflow-source-cancel-"));
  writeFileSync(join(root, "asset.txt"), Buffer.alloc(1024 * 1024 + 1, "a"));
  const abort = new AbortController();
  const observation = sourceIdentityAsync(root, ["asset.txt"], abort.signal);
  abort.abort();
  await expect(observation).rejects.toMatchObject({ code: "stale" });
});
