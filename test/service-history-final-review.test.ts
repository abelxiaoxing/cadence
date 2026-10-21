import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { HistoryRecovery } from "../src/history/recovery.ts";
import { inspectRecovery } from "../src/service/recovery.ts";
import { canonicalJson, type ExportFrame } from "../src/service-contract.ts";
import {
  admitFixtureRun,
  historyFixture,
  prepareFixtureChild,
} from "./helpers/history-fixture.ts";
import {
  readProjection,
  recordOwner,
  storedTree,
} from "./helpers/history-read-fixture.ts";

it("final review: publication snapshots its caller request before the first queued await", async () => {
  const f = historyFixture();
  f.context.task = null;
  f.writer.supplyContext(f.context);
  f.intent.runId = null;
  f.intent.createdTaskId = f.link.taskId;
  f.intent.identity = {
    kind: "action",
    expected: f.context,
    action: {
      kind: "create",
      taskKind: "research",
      goal: "Frozen publication",
    },
  };
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  const request = { operationId: f.intent.operationId, cwd: f.root };
  const original = f.writer.publishTask(request);
  request.cwd = join(f.dir, "does-not-exist");
  request.operationId = randomUUID();
  expect((await original).status).toBe("published");
  expect(f.c.store.load(f.link.taskId)?.cwd).toBe(f.root);
});

it.each(["intent", "artifacts"] as const)(
  "final review: recovery cannot race an original pending at %s despite injected ESRCH/local authority",
  async (boundary) => {
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((yes) => {
      release = yes;
    });
    const entered = new Promise<void>((yes) => {
      reached = yes;
    });
    let armed = false;
    const f = historyFixture({
      observeWrite: async (at) => {
        if (armed && at === boundary) {
          reached();
          await gate;
        }
      },
    });
    await f.writer.flush();
    armed = true;
    const original = f.writer.commit(f.intent);
    await entered;
    const probe = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(Error("injected ESRCH"), { code: "ESRCH" });
    });
    const recovery = new HistoryRecovery(f.c);
    try {
      const expected = await inspectRecovery(f.c, recovery),
        before = storedTree(f.dir);
      expect(f.writer.pendingWrites).toBe(1);
      await expect(
        recovery.append({
          expected,
          acknowledgeEscapedProcesses: true,
          processes: "externally-resolved",
          credentials: "independently-resolved",
          storage: "independently-resolved",
          assertLocalAuthority: () => {}, // Deliberately fabricated; cannot override an original W3 promise.
        }),
      ).rejects.toThrow();
      expect(storedTree(f.dir)).toEqual(before);
    } finally {
      probe.mockRestore();
      release();
      await original;
      await f.writer.settled();
    }
  },
);

it.each(["ndjson", "markdown"] as const)(
  "final review: an unfinished zero-byte field cannot yield a complete %s export",
  async (format) => {
    const f = historyFixture(),
      detailId = randomUUID();
    await recordOwner(f, {
      link: {
        epoch: f.link.epoch,
        taskId: f.link.taskId,
        runId: null,
        operationId: randomUUID(),
      },
      observedMs: 0,
      events: [
        {
          kind: "content-begin",
          detailId,
          owner: {
            taskId: f.link.taskId,
            runId: null,
            childRunId: null,
            entity: { kind: "task", id: f.link.taskId, version: 1 },
          },
          field: "plan",
          encoding: "utf8",
        },
      ],
    });
    const before = storedTree(f.dir),
      frames = [];
    expect(
      (
        await readProjection(f).search({
          storeId: f.files.format.storeId,
          scope: { kind: "task", id: f.link.taskId },
          snapshotSeq: f.writer.committedSeq,
          query: "missing",
          recordId: null,
          recordVersion: null,
          field: null,
          offset: 0,
        })
      ).coverage.observed,
    ).toBe("incomplete");
    for await (const frame of readProjection(f).export(
      {
        storeId: f.files.format.storeId,
        scope: { kind: "task", id: f.link.taskId },
        snapshotSeq: f.writer.committedSeq,
        format,
      },
      new AbortController().signal,
    ))
      frames.push(frame);
    expect(frames.at(-1)?.event).toMatchObject({
      kind: "trailer",
      complete: false,
      coverage: { observed: "incomplete", omissions: ["gap"] },
    });
    expect(storedTree(f.dir)).toEqual(before);
  },
);

it.skipIf(process.platform !== "linux" || !existsSync("/usr/bin/bwrap"))(
  "final review: native 16MiB private tmpfs ENOSPC preserves committed history and original handles (not admission bypass)",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "cadence-history-enospc-")),
      bundle = join(dir, "fixture.mjs");
    const built = spawnSync(
      "bun",
      [
        "build",
        "./test/helpers/history-enospc-child.ts",
        "--target=node",
        "--packages=external",
        `--outfile=${bundle}`,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(built.status, built.stderr).toBe(0);
    const roots = ["/usr", "/lib", "/lib64"].filter(existsSync);
    // The running Node may live outside /usr (nvm, a downloaded release).
    const node = realpathSync(process.execPath);
    const prefix = dirname(dirname(node));
    if (!roots.some((root) => prefix === root || prefix.startsWith(`${root}/`)))
      roots.push(prefix);
    const mounts = roots.flatMap((path) => ["--ro-bind", path, path]);
    const native = spawnSync(
      "/usr/bin/bwrap",
      [
        "--unshare-all",
        "--die-with-parent",
        "--clearenv",
        ...mounts,
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--size",
        "16777216",
        "--tmpfs",
        "/tmp",
        "--ro-bind",
        bundle,
        "/fixture.mjs",
        "--setenv",
        "HOME",
        "/tmp",
        "--setenv",
        "PATH",
        "/usr/bin",
        "--setenv",
        "TMPDIR",
        "/tmp",
        "--chdir",
        "/tmp",
        node,
        "/fixture.mjs",
      ],
      { encoding: "utf8", timeout: 15000, maxBuffer: 65536 },
    );
    expect(native.error).toBeUndefined();
    expect(native.status, native.stderr).toBe(0);
    expect(native.signal).toBeNull();
    expect(native.stderr).toBe("");
    const receipt = JSON.parse(native.stdout);
    expect(receipt).toMatchObject({
      native: true,
      sizeBytes: 16777216,
      admissionFloorRefused: true,
      artifactCode: "ENOSPC",
      appendCode: "ENOSPC",
      writeCode: "ENOSPC",
      opened: 1,
      closed: 1,
      prefixPreserved: true,
      locksPreserved: true,
      coldRead: { seq: "1", tail: true, exitCode: 0, signal: null, stderr: "" },
    });
    console.log("native-history-enospc", JSON.stringify(receipt));
  },
  20000,
);

it("final review: max-hit continuation preserves the selected field's source/redaction coverage", async () => {
  const f = historyFixture(),
    detailId = randomUUID();
  await recordOwner(f, {
    link: {
      epoch: f.link.epoch,
      taskId: f.link.taskId,
      runId: null,
      operationId: randomUUID(),
    },
    observedMs: 0,
    events: [
      {
        kind: "content-begin",
        detailId,
        owner: {
          taskId: f.link.taskId,
          runId: null,
          childRunId: null,
          entity: { kind: "task", id: f.link.taskId, version: 1 },
        },
        field: "plan",
        encoding: "utf8",
      },
      { kind: "content-chunk", detailId, text: "a".repeat(200) },
      {
        kind: "content-end",
        detailId,
        coverage: {
          observed: "complete",
          source: "limited",
          redacted: true,
          omissions: ["source-limit"],
        },
      },
    ],
  });
  const page = await readProjection(f).search({
    storeId: f.files.format.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: f.writer.committedSeq,
    query: "a",
    recordId: null,
    recordVersion: null,
    field: null,
    offset: 0,
  });
  expect(page.hits).toHaveLength(50);
  expect(page.next).not.toBeNull();
  expect(page.coverage).toEqual({
    observed: "complete",
    source: "limited",
    redacted: true,
    omissions: ["source-limit"],
  });
});

it("final review: metadata-only omissions survive search/export before a later capture-status exists", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  const source = { first: 1, last: 2, firstObservedMs: 0, lastObservedMs: 0 };
  const input = {
    link: f.link,
    source,
    events: [
      {
        source,
        event: { kind: "ready" as const, requestProtocol: 2 as const },
      },
      {
        source,
        event: {
          kind: "omitted-block" as const,
          block: {
            owner: {
              kind: "context" as const,
              component: "request-prompt" as const,
            },
            sourceType: "image" as const,
            mimeType: "image/png",
            reason: "binary" as const,
          },
        },
      },
    ],
  };
  const reserved = f.writer.capture(f.link).reserve({
    sourceFrames: 2,
    retainedBytes: 0,
    outputBytes: Buffer.byteLength(canonicalJson(input)),
    outputChunks: 2,
    lane: "data",
  });
  if (reserved.status !== "reserved") throw Error("fixture reserve");
  expect((await reserved.reservation.commit(input)).status).toBe("committed");
  const p = readProjection(f),
    scope = { kind: "child" as const, id: f.link.childRunId };
  const page = await p.search({
    storeId: f.files.format.storeId,
    scope,
    snapshotSeq: f.writer.committedSeq,
    query: "missing",
    recordId: null,
    recordVersion: null,
    field: null,
    offset: 0,
  });
  expect(page.coverage).toMatchObject({
    source: "limited",
    omissions: ["binary"],
  });
  let trailer: Extract<ExportFrame["event"], { kind: "trailer" }> | undefined;
  for await (const frame of p.export(
    {
      storeId: f.files.format.storeId,
      scope,
      snapshotSeq: f.writer.committedSeq,
      format: "ndjson",
    },
    new AbortController().signal,
  ))
    if (frame.event.kind === "trailer") trailer = frame.event;
  expect(trailer).toMatchObject({
    complete: true,
    coverage: { source: "limited", omissions: ["binary"] },
  });
});
