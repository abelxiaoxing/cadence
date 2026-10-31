import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it, vi } from "vitest";
import { HistoryFiles, HistoryReadBudget } from "../src/history/files.ts";
import { HistoryNavigation } from "../src/history/navigation.ts";
import { publicationPhase, summary } from "../src/history/publication.ts";
import { HistoryReader } from "../src/history/reader.ts";
import {
  HistoryRecovery,
  type RecoveryConfirmation,
} from "../src/history/recovery.ts";
import { RunState, readOperationState } from "../src/history/run-state.ts";
import { searchHistory } from "../src/history/search.ts";
import { COMPLETE } from "../src/history/types.ts";
import { HistoryWriter } from "../src/history/writer.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { ServiceOwner } from "../src/service/owner.ts";
import { inspectRecovery } from "../src/service/recovery.ts";
import { canonicalJson, LIMITS } from "../src/service-contract.ts";
import { legacyTaskStore, savedRecordIdentity } from "../src/task-store.ts";
import { TASK_SCHEMA } from "../src/task-types.ts";
import {
  admitFixtureRun,
  historyFixture,
  ownerFact,
  settleFixtureRun,
} from "./helpers/history-fixture.ts";
import { selectLegacy as legacy } from "./helpers/history-publication-fixture.ts";
import {
  storedTree as diskIdentity,
  recordOwner,
} from "./helpers/history-read-fixture.ts";

function createFixture(options: Parameters<typeof historyFixture>[0] = {}) {
  const f = historyFixture(options);
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
      goal: "Actual v1 publication",
    },
  };
  return f;
}
it("real held-checkout create publishes exact saved bytes and a separately committed receipt", async () => {
  const f = createFixture();
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  expect(legacyTaskStore(f.c).load(f.link.taskId)).toBeUndefined();
  const result = await f.writer.publishTask({
    operationId: f.intent.operationId,
    cwd: f.root,
  });
  expect(result.status).toBe("published");
  const saved = legacyTaskStore(f.c).loadSnapshot(f.link.taskId)!;
  expect(result.observed).toEqual({ revision: 1, identity: saved.identity });
  expect(saved.identity).toBe(savedRecordIdentity(saved.record));
  expect(saved.record.phase).toBe("planning");
  expect(readdirSync(join(legacyTaskStore(f.c).tasks, f.link.taskId))).toEqual([
    "task.json",
  ]);
  expect(await f.writer.lookup(f.intent.commandId)).toMatchObject({
    status: "found",
    record: {
      receipt: { publication: "published", created: { state: "published" } },
    },
  });
  expect(legacyTaskStore(f.c).inspectLock()).toEqual(f.lease.checkout);
});
it("Stop drains an already-started exact publication through original save/flush instead of quarantining its continuation", async () => {
  let reached!: () => void, resume!: () => void;
  const atSave = new Promise<void>((r) => {
    reached = r;
  });
  const gate = new Promise<void>((r) => {
    resume = r;
  });
  let owner!: ServiceOwner;
  const f = createFixture({
    onOriginal: (original, safety) => owner.trackHistory(original, safety),
    onFence: () => owner.quarantine(),
    observeWrite: async (at) => {
      if (at === "publication-before-save") {
        reached();
        await gate;
      }
    },
  });
  let closed = false;
  owner = new ServiceOwner(f.lease, {
    quiesce: () => f.writer.quiesce(),
    flush: () => f.writer.flush(),
    closeListener: async () => {
      closed = true;
    },
  });
  expect((await f.writer.commit(f.intent)).status).toBe("committed");
  const publication = f.writer.publishTask({
    operationId: f.intent.operationId,
    cwd: f.root,
  });
  owner.trackAccepted(
    publication.then((r) => ({
      status: r.status === "published" ? "settled" : "uncertain",
    })),
  );
  await atSave;
  const stop = owner.stop();
  expect(closed).toBe(false);
  expect(existsSync(legacyTaskStore(f.c).lockPath)).toBe(true);
  resume();
  expect((await publication).status).toBe("published");
  expect((await stop).state).toBe("stopped");
  expect(closed).toBe(true);
  expect(legacyTaskStore(f.c).load(f.link.taskId)?.phase).toBe("planning");
});
it.each(["edit", "delete", "corrupt"])(
  "publication %s conflict preserves exact external state and fences continuation",
  async (mode) => {
    let change = () => {};
    const f = historyFixture({
      observeWrite: (at) => {
        if (at === "publication-before-save") change();
      },
    });
    legacy(f);
    await f.writer.commit(f.intent);
    await admitFixtureRun(f);
    const path = join(legacyTaskStore(f.c).tasks, f.link.taskId, "task.json"),
      bytes = readFileSync(path);
    const external =
      mode === "edit"
        ? Buffer.from(`${bytes.toString().trimEnd()} \n`)
        : Buffer.from("{corrupt");
    change = () =>
      mode === "delete" ? unlinkSync(path) : writeFileSync(path, external);
    const result = await f.writer.publishTask({
      operationId: f.intent.operationId,
    });
    expect(result.status).toBe("conflict");
    expect(
      mode === "delete"
        ? existsSync(path)
        : readFileSync(path).equals(external),
    ).toBe(mode !== "delete");
    expect(f.writer.quarantined).toBe(true);
    expect(await f.writer.lookup(f.intent.commandId)).toMatchObject({
      status: "found",
      record: { receipt: { publication: "conflict" } },
    });
    expect(f.writer.accounting.episodes.count).toBe(1);
  },
);
it("creation cap refuses the 1001st acceptance without reserving a command or hiding old tasks", async () => {
  const f = createFixture();
  for (let i = 0; i < 1000; i++) {
    const id = randomUUID(),
      dir = join(legacyTaskStore(f.c).tasks, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task.json"),
      JSON.stringify({
        schema: TASK_SCHEMA,
        id,
        revision: 1,
        kind: "research",
        goal: "Existing fixture",
        plan: "",
        cwd: f.root,
        phase: "planning",
        result: "",
        baseline: "",
        checks: [],
        activity: [],
      }),
    );
  }
  expect((await f.writer.commit(f.intent)).status).toBe("refused");
  expect(legacyTaskStore(f.c).list()).toHaveLength(1000);
  expect(
    existsSync(join(f.files.directory, "commands", f.intent.commandId)),
  ).toBe(false);
});
it.each([
  "completed",
  "failed",
  "blocked",
  "canceled",
  "timeout",
  "unknown",
] as const)(
  "conservative %s phase mapping never human-closes execution",
  (outcome) => {
    const run = new RunState(randomUUID());
    run.settlement = { kind: "parent", outcome, required: [] };
    expect(publicationPhase(run)).toBe(
      outcome === "completed"
        ? "review"
        : ["failed", "blocked"].includes(outcome)
          ? "failed"
          : "interrupted",
    );
    expect(publicationPhase(run)).not.toBe("done");
    expect(summary("😀".repeat(10000), 16384, run.runId)).not.toContain("�");
  },
);
it("persisted resource policy is generation-bound; reopening cannot silently change a running ceiling", async () => {
  const f = createFixture({ quotaBytes: 1024 * 1024 * 1024 });
  await f.writer.commit(f.intent);
  const admission = [...f.files.scan()]
    .flatMap((b) => b.rows)
    .find((r) => r.value.kind === "admission")!;
  expect(admission.value).toMatchObject({
    policy: {
      generation: 1,
      quotaBytes: 1024 * 1024 * 1024,
      freeSpaceFloorBytes: LIMITS.freeSpaceFloorBytes,
    },
  });
  expect(() => new HistoryWriter(f.lease)).toThrow();
});

let child: string;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-w3-publication-child-"));
  child = join(dir, "child.mjs");
  const build = spawnSync(
    "bun",
    [
      "build",
      "./test/helpers/history-publication-child.ts",
      "--target=node",
      "--packages=external",
      `--outfile=${child}`,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  expect(build.status, build.stderr).toBe(0);
});
function crash(boundary: string) {
  const dir = mkdtempSync(join(tmpdir(), "cadence-w3-original-crash-"));
  const original = spawnSync(process.execPath, [child, dir, boundary], {
    encoding: "utf8",
    timeout: 15000,
  });
  expect(original.error).toBeUndefined();
  expect(original.signal).toBeNull();
  expect(original.status, original.stderr).toBe(77);
  const c = new ServiceCoordination(join(dir, "project"), join(dir, "state"));
  return {
    dir,
    c,
    files: HistoryFiles.open(c)!,
    selected: JSON.parse(readFileSync(join(dir, "selection.json"), "utf8")),
  };
}
async function confirmation(
  c: ServiceCoordination,
): Promise<RecoveryConfirmation> {
  const recovery = new HistoryRecovery(c),
    expected = await inspectRecovery(c, recovery);
  // Fabricated management authority/independent operator acknowledgments, NOT a production CLI.
  return {
    expected,
    processes: "externally-resolved",
    credentials: "independently-resolved",
    storage: "independently-resolved",
    acknowledgeEscapedProcesses: true,
    assertLocalAuthority: (choice) => {
      expect(choice.coordinationDigest).toBe(expected.coordinationDigest);
      expect(choice.owner).toBe("absent");
    },
  };
}
it.each([
  "publication-before-save",
  "publication-after-save",
  "outcome-journal",
  "outcome-commit",
])(
  "original child crash at %s preserves honest publication state and v1 bytes",
  async (boundary) => {
    const f = crash(boundary),
      before = diskIdentity(f.dir);
    const state = readOperationState(f.files, f.selected.operationId);
    const published = boundary === "outcome-commit";
    expect(state.receipt()?.receipt.publication).toBe(
      published ? "published" : "pending",
    );
    expect(!!legacyTaskStore(f.c).load(f.selected.taskId)).toBe(
      boundary !== "publication-before-save",
    );
    const recovery = new HistoryRecovery(f.c);
    expect((await inspectRecovery(f.c, recovery)).owner).toBe("absent");
    expect(diskIdentity(f.dir)).toEqual(before);
    expect(() =>
      f.c.acquire({
        schema: "cadence-service-owner-config/1",
        endpoint: "http://127.0.0.1:17423",
        policyIdentity: "a".repeat(64),
      }),
    ).toThrow();
  },
);
it("readonly recovery rejects live owners and missing authority without writes", async () => {
  const f = createFixture();
  await f.writer.commit(f.intent);
  const recovery = new HistoryRecovery(f.c),
    before = diskIdentity(f.dir);
  const selected = await confirmation(f.c);
  await expect(recovery.append(selected)).rejects.toThrow();
  const missing = { ...selected, assertLocalAuthority: undefined };
  // Runtime boundary deliberately malformed, not an accepting TypeScript cast.
  await expect(
    recovery.append(missing as unknown as RecoveryConfirmation),
  ).rejects.toThrow();
  expect(diskIdentity(f.dir)).toEqual(before);
});
it.each([
  "authority",
  "processes",
  "credentials",
  "storage",
  "stale",
  "changed-in-callback",
])(
  "guarded recovery refuses %s and never removes coordination locks",
  async (mode) => {
    const f = crash("tail"),
      recovery = new HistoryRecovery(f.c),
      selected = await confirmation(f.c);
    const lock = readFileSync(legacyTaskStore(f.c).lockPath);
    if (mode === "authority")
      selected.assertLocalAuthority = () => {
        throw Error("fabricated local authority refusal");
      };
    if (mode === "stale") appendFileSync(f.files.segmentPath(1), "changed");
    if (mode === "changed-in-callback")
      selected.assertLocalAuthority = () => {
        appendFileSync(f.files.segmentPath(1), "changed");
      };
    if (["processes", "credentials", "storage"].includes(mode))
      Object.assign(selected, { [mode]: "unknown" });
    await expect(recovery.append(selected)).rejects.toThrow();
    expect(readFileSync(legacyTaskStore(f.c).lockPath)).toEqual(lock);
    expect(existsSync(f.files.segmentPath(2))).toBe(false);
  },
);
it("torn FINAL bytes survive an explicit bridge; new monotonically separated batches retain old ranges", async () => {
  const f = crash("tail"),
    recovery = new HistoryRecovery(f.c),
    original = readFileSync(f.files.segmentPath(1));
  const old = f.files.inspect(),
    first = [...f.files.scan()][0];
  const choice = await confirmation(f.c),
    locks = f.c.recoverySnapshot().digest;
  const fact = await recovery.append(choice);
  expect(BigInt(fact.committedSeq)).toBeGreaterThan(
    BigInt(old.highSeq ?? old.committedSeq),
  );
  expect(readFileSync(f.files.segmentPath(1))).toEqual(original);
  expect(f.c.recoverySnapshot().digest).toBe(locks);
  expect(f.files.inspect().tail).toBe(false);
  expect([...f.files.scan()][0].rows).toEqual(first.rows);
  const nav = new HistoryNavigation(f.files),
    budget = new HistoryReadBudget();
  expect(nav.snapshot(old.committedSeq, budget)?.seq).toBe(old.committedSeq);
  expect(nav.snapshot(fact.committedSeq, new HistoryReadBudget())?.seq).toBe(
    fact.committedSeq,
  );
  expect((await recovery.inspect(choice.expected.epoch)).storage).toBe(
    "independently-resolved",
  );
  // W3 returned a durable fact but W1 intentionally STILL refuses lock takeover.
  expect(() =>
    f.c.acquire({
      schema: "cadence-service-owner-config/1",
      endpoint: "http://127.0.0.1:17423",
      policyIdentity: "a".repeat(64),
    }),
  ).toThrow();
});
it("unmatched auth is independent of process closure and remains inspectable after recovery", async () => {
  const f = crash("auth"),
    recovery = new HistoryRecovery(f.c),
    selected = await confirmation(f.c);
  expect(selected.expected.history).toMatchObject({
    credentials: "unknown",
    processes: "externally-resolved",
  });
  const original = [...f.files.scan()]
    .flatMap((b) => b.rows)
    .filter((r) => r.value.kind === "auth-preparation");
  expect(original).toHaveLength(1);
  await recovery.append(selected);
  expect(
    [...f.files.scan()]
      .flatMap((b) => b.rows)
      .filter((r) => r.value.kind === "auth-preparation"),
  ).toEqual(original);
  expect(
    [...f.files.scan()]
      .flatMap((b) => b.rows)
      .filter((r) => r.value.kind === "launch"),
  ).toHaveLength(0);
});
it("interior corruption cannot be repaired into success by a recovery append", async () => {
  const f = crash("tail"),
    path = f.files.segmentPath(1),
    original = readFileSync(path);
  original[0] = 120;
  writeFileSync(path, original);
  const recovery = new HistoryRecovery(f.c);
  await expect(confirmation(f.c)).rejects.toThrow();
  await expect(
    recovery.inspect(f.c.recoverySnapshot().registration.epoch),
  ).rejects.toThrow();
  expect(readFileSync(path)).toEqual(original);
  expect(existsSync(f.files.segmentPath(2))).toBe(false);
});

it.each(["rename-before", "rename-after"])(
  "original child dies at actual TaskStore %s boundary without repair",
  (boundary) => {
    const f = crash(boundary),
      dir = join(legacyTaskStore(f.c).tasks, f.selected.taskId),
      before = diskIdentity(f.dir);
    expect(
      readOperationState(f.files, f.selected.operationId).receipt()?.receipt
        .publication,
    ).toBe("pending");
    if (boundary === "rename-before") {
      expect(existsSync(join(dir, "task.json"))).toBe(false);
      expect(readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(true);
      expect(() =>
        legacyTaskStore(f.c).loadSnapshot(f.selected.taskId),
      ).toThrow();
    } else
      expect(
        legacyTaskStore(f.c).loadSnapshot(f.selected.taskId)?.record.revision,
      ).toBe(1);
    expect(diskIdentity(f.dir)).toEqual(before);
  },
);
it("uncommitted complete tail rows cannot reuse their sequence after explicit recovery", async () => {
  const f = crash("outcome-journal"),
    old = f.files.inspect(),
    recovery = new HistoryRecovery(f.c);
  expect(BigInt(old.highSeq!)).toBeGreaterThan(BigInt(old.committedSeq));
  const fact = await recovery.append(await confirmation(f.c));
  expect(BigInt(fact.committedSeq)).toBe(BigInt(old.highSeq!) + 1n);
  expect(f.files.inspect().committedSeq).toBe(fact.committedSeq);
  expect(
    new HistoryNavigation(f.files).snapshot(
      fact.committedSeq,
      new HistoryReadBudget(),
    )?.seq,
  ).toBe(fact.committedSeq);
  expect(
    readOperationState(f.files, f.selected.operationId).receipt()?.receipt
      .publication,
  ).toBe("pending");
});
it("a changed affected history after the original recovery body is written prevents durable success", async () => {
  const f = crash("tail"),
    recovery = new HistoryRecovery(f.c),
    choice = await confirmation(f.c),
    locks = f.c.recoverySnapshot().digest;
  await expect(
    recovery.append(choice, (at) => {
      if (at === "journal")
        appendFileSync(f.files.segmentPath(1), "changed-original");
    }),
  ).rejects.toThrow();
  expect(f.c.recoverySnapshot().digest).toBe(locks);
  expect(readFileSync(f.files.segmentPath(1), "utf8")).toContain(
    "changed-original",
  );
  expect(existsSync(f.files.segmentPath(2))).toBe(true);
});
it("reopened writer after a guarded bridge has no old dispatch authority (injected ESRCH only)", async () => {
  const f = historyFixture();
  legacy(f);
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  expect(new HistoryWriter(f.lease).quarantined).toBe(true);
  // Explicit process-status injection permits testing W3 reopen WITHOUT changing or removing W1 locks.
  const probe = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
    expect(signal).toBe(0);
    throw Object.assign(Error("fixture ESRCH"), { code: "ESRCH" });
  });
  try {
    const recovery = new HistoryRecovery(f.c);
    await recovery.append(await confirmation(f.c));
  } finally {
    probe.mockRestore();
  }
  const before = diskIdentity(f.dir),
    reopened = new HistoryWriter(f.lease);
  expect((await f.writer.flush()).status).toBe("refused");
  expect(
    (await f.writer.publishTask({ operationId: f.intent.operationId })).status,
  ).toBe("refused");
  expect(diskIdentity(f.dir)).toEqual(before);
  expect(reopened.quarantined).toBe(false);
  expect(reopened.pendingWrites).toBe(0);
  expect(reopened.accounting.episodes.count).toBe(0);
  expect(() => reopened.capture(f.link)).toThrow();
  expect(diskIdentity(f.dir)).toEqual(before);
  expect((await reopened.commit(f.intent)).status).toBe("existing");
  expect((await reopened.flush()).status).toBe("committed");
  const context = { ...f.context, controlRev: 2 };
  reopened.supplyContext(context);
  const fresh = {
    ...f.intent,
    commandId: randomUUID(),
    operationId: randomUUID(),
    runId: randomUUID(),
    identity: {
      kind: "action" as const,
      expected: context,
      action: { kind: "generate-plan" as const, taskId: f.link.taskId },
    },
  };
  expect((await reopened.commit(fresh)).status).toBe("committed");
  const historical = [
    ...new HistoryNavigation(reopened.files).reverseBatches(
      f.link.runId,
      reopened.committedSeq,
      new HistoryReadBudget(),
    ),
  ];
  expect(
    historical.some((b) =>
      b.rows.some(
        (r) =>
          r.value.kind === "admission" &&
          r.value.intent.commandId === f.intent.commandId,
      ),
    ),
  ).toBe(true);
  expect(() => reopened.capture(f.link)).toThrow();
});
it("explicit human closure preserves not-run and stale native-zero checks instead of upgrading execution", async () => {
  const observation = {
    identity: "a".repeat(64),
    complete: false,
    checkoutGeneration: 0,
  };
  let taskId = "";
  const f = historyFixture({
    reviewContext: () => ({
      observation,
      recordingIncomplete: false, // injected obligation fixture; no executed check output
      checks: {
        taskId,
        revision: 7,
        definitions: [
          {
            selection: {
              kind: "configured",
              name: "required",
              command: "true",
              timeoutMs: 1000,
            },
            status: "not-run",
            checkId: null,
          },
        ],
      },
    }),
  });
  taskId = f.link.taskId;
  legacy(f, {
    checks: [
      {
        name: "old",
        command: "true",
        timeoutMs: 1000,
        cwd: f.root,
        durationMs: 1,
        exitCode: 0,
        status: "stale",
        fingerprint: "a".repeat(64),
      },
    ],
  });
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  await settleFixtureRun(f, "blocked");
  const oldCommand = f.intent.commandId,
    runId = f.link.runId;
  async function content(kind: "changes" | "review", id: string) {
    const detailId = randomUUID();
    const b = await recordOwner(f, {
      link: {
        epoch: f.link.epoch,
        taskId,
        runId,
        operationId: f.intent.operationId,
      },
      observedMs: 0,
      events: [
        {
          kind: "content-begin",
          detailId,
          owner: {
            taskId,
            runId,
            childRunId: null,
            entity: { kind, id, version: 1 },
          },
          field: kind,
          encoding: "utf8",
        },
        { kind: "content-chunk", detailId, text: "reviewed fixture issues" },
        { kind: "content-end", detailId, coverage: COMPLETE },
      ],
    });
    return b.ownerDetails[0].content;
  }
  const observationId = randomUUID(),
    changes = await content("changes", observationId);
  expect(
    (
      await ownerFact(f, {
        kind: "changes",
        observationId,
        stage: "review",
        observation,
        content: changes,
      })
    ).status,
  ).toBe("committed");
  f.intent = {
    commandId: randomUUID(),
    operationId: randomUUID(),
    runId: null,
    createdTaskId: null,
    identity: {
      kind: "action",
      expected: f.writer.currentContext(taskId)!,
      action: {
        kind: "review",
        taskId,
        runId,
        changesIdentity: observation.identity,
        checksRevision: 7,
        acceptIssues: true,
      },
    },
  };
  await f.writer.commit(f.intent);
  const reviewId = randomUUID(),
    review = await content("review", reviewId);
  expect(
    (
      await ownerFact(f, {
        kind: "review",
        reviewId,
        runId,
        changesIdentity: observation.identity,
        checksRevision: 7,
        acceptIssues: true,
        outcome: "reviewed-with-issues",
        content: review,
      })
    ).status,
  ).toBe("committed");
  expect(
    (await f.writer.publishTask({ operationId: f.intent.operationId })).status,
  ).toBe("published");
  const saved = legacyTaskStore(f.c).load(taskId)!;
  expect(saved.phase).toBe("done");
  expect(saved.review?.outcome).toBe("reviewed-with-issues");
  expect(saved.checks[0]).toMatchObject({ status: "stale", exitCode: 0 });
  expect(await f.writer.lookup(oldCommand)).toMatchObject({
    status: "found",
    record: { receipt: { execution: "blocked" } },
  });
});
it("a low-level fabricated published fact cannot substitute for observed v1 bytes", async () => {
  const f = historyFixture();
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  const publicationId = randomUUID();
  expect(
    (
      await ownerFact(f, {
        kind: "publication-intent",
        publicationId,
        expectedRevision: 1,
        expectedIdentity: "a".repeat(64),
        nextRevision: 2,
        nextIdentity: "b".repeat(64),
      })
    ).status,
  ).toBe("committed");
  expect(
    (
      await ownerFact(f, {
        kind: "publication-settled",
        publicationId,
        status: "published",
        observed: { revision: 2, identity: "b".repeat(64) },
      })
    ).status,
  ).toBe("refused");
  expect(f.writer.quarantined).toBe(true);
});

it.each(
  ["edit", "missing", "corrupt"].flatMap((mode) =>
    [false, true].map((published) => ({ mode, published })),
  ),
)(
  "selected v1 $mode before intent gets a durable uncertain refusal, never a reset (prior publication: $published)",
  async ({ mode, published }) => {
    const f = historyFixture();
    legacy(f);
    await f.writer.commit(f.intent);
    await admitFixtureRun(f);
    if (published)
      expect(
        (await f.writer.publishTask({ operationId: f.intent.operationId }))
          .status,
      ).toBe("published");
    await settleFixtureRun(f, "blocked");
    const path = join(legacyTaskStore(f.c).tasks, f.link.taskId, "task.json");
    if (mode === "missing") unlinkSync(path);
    else
      writeFileSync(
        path,
        mode === "corrupt" ? "corrupt" : `${readFileSync(path, "utf8")} `,
      );
    const before = existsSync(path) ? readFileSync(path) : null;
    expect(
      (await f.writer.publishTask({ operationId: f.intent.operationId }))
        .status,
    ).toBe("uncertain");
    expect(await f.writer.lookup(f.intent.commandId)).toMatchObject({
      status: "found",
      record: { receipt: { publication: "uncertain", execution: "blocked" } },
    });
    expect(existsSync(path) ? readFileSync(path) : null).toEqual(before);
    expect(new HistoryWriter(f.lease).quarantined).toBe(true);
    expect((await new HistoryRecovery(f.c).inspect(f.link.epoch)).storage).toBe(
      "unknown",
    );
  },
);
it.each([0, 32])(
  "real check publication keeps native-zero stale facts and the %s existing-check cap",
  async (count) => {
    const f = historyFixture();
    const check = {
      kind: "configured" as const,
      name: "check",
      command: "true",
      timeoutMs: 1000,
    };
    legacy(f, {
      kind: "code",
      checks: Array.from({ length: count }, (_, i) => ({
        name: `prior-${i}`,
        command: "true",
        timeoutMs: 1000,
        cwd: f.root,
        exitCode: 0,
        durationMs: 1,
        status: "passed" as const,
        fingerprint: "a".repeat(64),
      })),
    });
    f.intent.identity = {
      kind: "action",
      expected: f.context,
      action: { kind: "check", taskId: f.link.taskId, check },
    };
    await f.writer.commit(f.intent);
    await f.writer.admitRun(f.link.runId, {
      operationId: f.intent.operationId,
      commandId: f.intent.commandId,
      kind: "check",
      context: f.context,
      graph: null,
      assignments: [],
    });
    const checkId = randomUUID(),
      before = {
        identity: "a".repeat(64),
        complete: true,
        checkoutGeneration: 0,
      },
      after = { ...before, identity: "b".repeat(64), checkoutGeneration: 1 };
    expect(
      (
        await ownerFact(f, {
          kind: "check-start",
          checkId,
          selection: check,
          cwdId: f.context.cwdId,
          cwdLabel: f.root,
          checkEnvGeneration: 1,
          before,
        })
      ).status,
    ).toBe("committed");
    expect(
      (
        await ownerFact(f, {
          kind: "check-settled",
          checkId,
          native: {
            outcome: "completed",
            closure: "direct-child-closed",
            exitCode: 0,
            signal: null,
            durationMs: 1,
            stdin: "not-required",
          },
          before,
          after,
          output: null,
          coverage: COMPLETE,
          status: "stale",
        })
      ).status,
    ).toBe("committed");
    const result = await f.writer.publishTask({
      operationId: f.intent.operationId,
    });
    if (count === 32) {
      expect(result.status).toBe("uncertain");
      expect(new HistoryWriter(f.lease).quarantined).toBe(true);
    } else {
      expect(result.status).toBe("published");
      expect(legacyTaskStore(f.c).load(f.link.taskId)?.checks[0]).toMatchObject(
        {
          exitCode: 0,
          status: "stale",
        },
      );
      expect(legacyTaskStore(f.c).load(f.link.taskId)?.phase).toBe("review");
    }
    expect(legacyTaskStore(f.c).load(f.link.taskId)?.checks).toHaveLength(
      count === 32 ? 32 : 1,
    );
  },
);
it("actual dead-owner recovery retains exact old search/detail cursor and reports bridged coverage incomplete", async () => {
  const f = crash("tail"),
    reader = HistoryReader.open(f.c)!;
  const seed = {
    storeId: reader.storeId,
    scope: { kind: "task" as const, id: f.selected.taskId },
    snapshotSeq: f.files.inspect().committedSeq,
    query: "Crash",
    recordId: null,
    recordVersion: null,
    field: null,
    offset: 0,
  };
  const result = await searchHistory(reader, seed);
  expect(result.hits).toHaveLength(1);
  const cursor = result.hits[0].cursor,
    page = await reader.detail(cursor);
  const recovery = new HistoryRecovery(f.c),
    fact = await recovery.append(await confirmation(f.c));
  expect(await HistoryReader.open(f.c)!.detail(cursor)).toEqual(page);
  const after = await searchHistory(HistoryReader.open(f.c)!, {
    ...seed,
    snapshotSeq: fact.committedSeq,
  });
  const retained = [
    ...new HistoryNavigation(HistoryFiles.open(f.c)!).reverseBatches(
      f.selected.taskId,
      fact.committedSeq,
      new HistoryReadBudget(),
    ),
  ];
  expect(
    retained.some((b) =>
      b.rows.some(
        (r) =>
          r.value.kind === "admission" &&
          r.value.intent.createdTaskId === f.selected.taskId,
      ),
    ),
  ).toBe(true);
  expect(after.hits[0].content).toEqual(result.hits[0].content);
  expect(after.hits[0].range).toEqual(result.hits[0].range);
  expect(after.coverage).toMatchObject({
    observed: "incomplete",
    omissions: ["gap"],
  });
});
it("ambiguous original-owner probe refuses recovery without treating EPERM as dead", async () => {
  const f = crash("tail"),
    recovery = new HistoryRecovery(f.c),
    choice = await confirmation(f.c),
    before = diskIdentity(f.dir);
  const probe = vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(Error("injected probe"), { code: "EPERM" });
  });
  try {
    await expect(recovery.append(choice)).rejects.toThrow();
  } finally {
    probe.mockRestore();
  }
  expect(diskIdentity(f.dir)).toEqual(before);
});

it("final review: checksum-valid recovery cannot invent an uncommitted sequence gap in navigation/search", async () => {
  const f = crash("tail"),
    recovery = new HistoryRecovery(f.c);
  const old = f.files.inspect();
  await recovery.append(await confirmation(f.c));
  const path = f.files.segmentPath(old.segment + 1);
  const [row, marker] = readFileSync(path, "utf8")
    .trimEnd()
    .split("\n")
    .map((s) => JSON.parse(s));
  row.value.previous.highSeq = String(BigInt(old.highSeq!) + 10n);
  row.seq = String(BigInt(row.value.previous.highSeq) + 1n);
  marker.first = marker.last = row.seq;
  const body = `${canonicalJson(row)}\n`;
  marker.sha256 = createHash("sha256").update(body).digest("hex");
  writeFileSync(path, `${body}${canonicalJson(marker)}\n`);
  const before = diskIdentity(f.dir);
  expect(() => f.files.inspect()).toThrow();
  expect(() =>
    new HistoryNavigation(f.files).snapshot(row.seq, new HistoryReadBudget()),
  ).toThrow();
  await expect(
    searchHistory(HistoryReader.open(f.c)!, {
      storeId: f.files.format.storeId,
      scope: { kind: "task", id: f.selected.taskId },
      snapshotSeq: row.seq,
      query: "Crash",
      recordId: null,
      recordVersion: null,
      field: null,
      offset: 0,
    }),
  ).rejects.toThrow();
  expect(diskIdentity(f.dir)).toEqual(before);
});

it.each(["journal", "commit"] as const)(
  "recovery pins exact key incarnation across %s boundary",
  async (boundary) => {
    const f = crash("tail"),
      recovery = new HistoryRecovery(f.c),
      choice = await confirmation(f.c);
    const locks = f.c.recoverySnapshot().digest,
      key = join(f.files.directory, "read-proof-key.json"),
      original = readFileSync(key);
    let replaced = false;
    await expect(
      recovery.append(choice, (at) => {
        if (at !== boundary) return;
        renameSync(key, join(f.dir, `preserved-key-${boundary}.json`));
        writeFileSync(key, original, { mode: 0o600, flag: "wx" });
        replaced = true;
      }),
    ).rejects.toThrow();
    expect(replaced).toBe(true);
    expect(readFileSync(key)).toEqual(original);
    expect(f.c.recoverySnapshot().digest).toBe(locks);
    expect(existsSync(f.files.segmentPath(2))).toBe(true);
    expect(() => HistoryFiles.open(f.c)!.assertRecoveryIdle()).toThrow();
  },
);

it.each([
  "bytes",
  "sha256",
  "committedBytes",
  "committedSeq",
  "segment",
  "previous",
] as const)(
  "original forward proof rejects checksum-valid forged bridge %s",
  async (field) => {
    const f = crash("tail"),
      recovery = new HistoryRecovery(f.c),
      prior = f.files.inspect();
    await recovery.append(await confirmation(f.c));
    const path = f.files.segmentPath(prior.segment + 1);
    const [row, marker] = readFileSync(path, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (field === "sha256") row.value.previous.sha256 = "0".repeat(64);
    else if (field === "committedSeq" || field === "previous") {
      const earlier = String(BigInt(prior.committedSeq) - 1n);
      row.value.previous.committedSeq = earlier;
      marker.previous = earlier;
    } else row.value.previous[field] += field === "committedBytes" ? -1 : 1;
    const body = `${canonicalJson(row)}\n`;
    marker.sha256 = createHash("sha256").update(body).digest("hex");
    writeFileSync(path, `${body}${canonicalJson(marker)}\n`);
    const before = diskIdentity(f.dir);
    expect(() => f.files.inspect()).toThrow();
    await expect(
      searchHistory(HistoryReader.open(f.c)!, {
        storeId: f.files.format.storeId,
        scope: { kind: "task", id: f.selected.taskId },
        snapshotSeq: marker.last,
        query: "Crash",
        recordId: null,
        recordVersion: null,
        field: null,
        offset: 0,
      }),
    ).rejects.toThrow();
    expect(diskIdentity(f.dir)).toEqual(before);
  },
);

it.each(["reused-id", "invented-success", "observed-refusal"])(
  "a subsequent pre-effect refusal cannot carry %s publication authority",
  async (mode) => {
    const f = historyFixture();
    legacy(f);
    await f.writer.commit(f.intent);
    await admitFixtureRun(f);
    const published = await f.writer.publishTask({
      operationId: f.intent.operationId,
    });
    expect(published.status).toBe("published");
    if (!published.publicationId || !published.observed)
      throw Error("publication");
    const path = join(legacyTaskStore(f.c).tasks, f.link.taskId, "task.json");
    const before = readFileSync(path);
    expect(
      (
        await ownerFact(f, {
          kind: "publication-settled",
          publicationId:
            mode === "reused-id" ? published.publicationId : randomUUID(),
          status: mode === "invented-success" ? "published" : "uncertain",
          observed: mode === "reused-id" ? null : published.observed,
        })
      ).status,
    ).toBe("refused");
    expect(f.writer.quarantined).toBe(true);
    expect(readFileSync(path)).toEqual(before);
  },
);
