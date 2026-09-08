import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { BubblewrapIsolationBackend } from "../src/isolation-backend.ts";
import { prepareVerificationEnvironment } from "../src/verification-environment.ts";
import { coalesceVerificationScans } from "../src/verification-scan.ts";

const roots: string[] = [];
function temporary() {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-review-regression-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("never joins an older in-flight scan for a post-verification check", async () => {
  let value = "old";
  const release: Array<() => void> = [];
  const scan = coalesceVerificationScans(async () => {
    const observed = value;
    await new Promise<void>((resolve) => release.push(resolve));
    return observed;
  });
  const earlier = scan({});
  await Promise.resolve();
  value = "changed-during-verification";
  const later = scan({});
  await Promise.resolve();
  expect(release).toHaveLength(2);
  for (const resolve of release) resolve();
  expect(await earlier).toBe("old");
  expect(await later).toBe("changed-during-verification");
});

it("prepares dependency copies off-thread and drains cancellation before cleanup", async () => {
  vi.stubEnv("ABEL_EXECUTION_MODE", "local-trusted");
  const root = temporary();
  const owner = path.join(root, "owner");
  const candidate = path.join(root, "candidate");
  mkdirSync(path.join(owner, "node_modules/pkg"), { recursive: true });
  mkdirSync(candidate);
  for (let i = 0; i < 4000; i++)
    writeFileSync(
      path.join(owner, "node_modules/pkg", `${i}.js`),
      "x".repeat(4096),
    );
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  try {
    const metrics: any[] = [];
    const prepared = await prepareVerificationEnvironment(
      candidate,
      owner,
      [],
      undefined,
      (metric) => metrics.push(metric),
    );
    expect(ticks).toBeGreaterThan(0);
    expect(metrics[0].operation).toBe("prepareVerification");
    await prepared.cleanup();
    const controller = new AbortController();
    const pending = prepareVerificationEnvironment(
      candidate,
      owner,
      [],
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow();
    setTimeout(() => controller.abort(), 10);
    await rejected;
    expect(
      readdirSync(root).filter((name) =>
        name.startsWith(".cadence-verification-"),
      ),
    ).toEqual([]);
    const files = readdirSync(path.join(candidate, "node_modules/pkg")).length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(readdirSync(path.join(candidate, "node_modules/pkg")).length).toBe(
      files,
    );
  } finally {
    clearInterval(timer);
  }
}, 20000);

it.skipIf(process.env.CADENCE_REAL_ISOLATION !== "1")(
  "kills detached trusted descendants before cancelled execution settles",
  async () => {
    const root = temporary();
    writeFileSync(
      path.join(root, "descendant.mjs"),
      "import {appendFileSync} from 'node:fs';setInterval(()=>appendFileSync('heartbeat','x'),10);",
    );
    writeFileSync(
      path.join(root, "parent.mjs"),
      "import {spawn} from 'node:child_process';spawn(process.execPath,['descendant.mjs'],{detached:true,stdio:'ignore'}).unref();setInterval(()=>{},1000);",
    );
    const controller = new AbortController();
    const pending = new BubblewrapIsolationBackend({
      localTrusted: true,
      timeoutMs: 10000,
      terminateGraceMs: 50,
    }).run({
      root,
      executable: process.execPath,
      args: ["parent.mjs"],
      signal: controller.signal,
    });
    try {
      await expect
        .poll(
          () => {
            try {
              return readFileSync(path.join(root, "heartbeat"), "utf8").length;
            } catch {
              return 0;
            }
          },
          { timeout: 5000 },
        )
        .toBeGreaterThan(0);
    } finally {
      controller.abort();
    }
    expect(await pending).toMatchObject({ state: "cancelled" });
    const stopped = readFileSync(path.join(root, "heartbeat"), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(readFileSync(path.join(root, "heartbeat"), "utf8")).toBe(stopped);
  },
  15000,
);

it("does not claim trusted execution without its PID isolation backend", async () => {
  expect(
    await new BubblewrapIsolationBackend({
      localTrusted: true,
      probe: () => false,
    }).available(),
  ).toBe(false);
});
