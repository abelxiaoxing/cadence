// The owner's rename and archive rules, with the rename child replaced by a
// controlled stand-in for Pi. The real child is `session-rename.test.ts`.
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { ContractError } from "../src/service/contracts/core.ts";
import type { WorkbenchCommand } from "../src/service/contracts/workbench.ts";
import { Conversations, type LiveTurn } from "../src/service/conversations.ts";
import type { ServiceCoordination } from "../src/service/coordination.ts";
import { sessionDirectory } from "../src/service/pi-sessions.ts";
import { PrivateFiles } from "../src/service/private-files.ts";
import type { SessionRename } from "../src/subagent-process.ts";
import type { RunResult } from "../src/task-types.ts";
import { seedPiSessions } from "./helpers/retained-conversations.ts";

type Launch = (
  target: SessionRename,
  signal: AbortSignal,
  maySignal: () => boolean,
) => Promise<RunResult>;
const child = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock("../src/subagent-process.ts", async (original) => ({
  ...(await original<typeof import("../src/subagent-process.ts")>()),
  renameSession: child.rename,
}));

const closed = (outcome: RunResult["outcome"] = "completed"): RunResult => ({
  outcome,
  closed: outcome !== "unknown",
  exitCode: outcome === "completed" ? 0 : outcome === "unknown" ? null : 1,
  signal: null,
  durationMs: 1,
  text: "",
  output: "",
  truncated: false,
});
/** What Pi's `appendSessionInfo` leaves in the file. */
const record = (target: SessionRename) =>
  appendFileSync(
    target.file,
    `${JSON.stringify({
      type: "session_info",
      id: randomUUID().slice(0, 8),
      parentId: null,
      timestamp: new Date().toISOString(),
      name: target.name,
    })}\n`,
  );
const renamed: Launch = async (target) => {
  record(target);
  return closed();
};
beforeEach(() => {
  child.rename.mockReset().mockImplementation(renamed);
});

function fixture(sessions = 3) {
  const root = mkdtempSync(join(tmpdir(), "conversation-rename-"));
  const cwd = join(root, "project"),
    agentDir = join(root, "agent");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  const tracked = {
    work: [] as Promise<{ status: string }>[],
    stops: [] as (() => void)[],
  };
  let held = true;
  const owner = {
    state: "idle",
    refuse: false,
    lease: {
      assert() {
        if (!held) throw new ContractError("stale");
      },
    },
    trackConversation(original: Promise<{ status: string }>, stop: () => void) {
      if (owner.refuse) throw new ContractError("quarantine");
      tracked.work.push(original);
      tracked.stops.push(stop);
    },
    quarantine() {
      owner.state = "quarantined";
    },
  };
  let secrets: string[] = [];
  const files = new PrivateFiles(root);
  const conversations = new Conversations({
    coordination: {
      directory: join(root, "service-v1"),
      files,
      store: { root: cwd },
    } as unknown as ServiceCoordination,
    owner: owner as never,
    models: {} as never,
    choice: {} as never,
    gate: {} as never,
    agentDir,
    cwd,
    secrets: () => secrets,
  });
  const directory = sessionDirectory(cwd, agentDir);
  const seeded = seedPiSessions(directory, cwd, sessions);
  const sessionBytes = () => {
    const digest = createHash("sha256");
    for (const name of readdirSync(directory).sort())
      digest.update(name).update(readFileSync(join(directory, name)));
    return digest.digest("hex");
  };
  const rename = (
    conversationId: string,
    name: string,
    commandId = randomUUID(),
  ) =>
    conversations.rename({
      kind: "conversation-rename",
      commandId,
      conversationId,
      name,
    });
  const archive = (conversationId: string, archived: boolean) =>
    conversations.archive({
      kind: "conversation-archive",
      commandId: randomUUID(),
      conversationId,
      archived,
    });
  return {
    conversations,
    records: conversations.records,
    owner,
    tracked,
    files,
    cwd,
    directory,
    ids: seeded.ids,
    sessionBytes,
    rename,
    archive,
    title: (id: string) => conversations.records.summary(id, undefined)?.title,
    secrets(value: string[]) {
      secrets = value;
    },
    lease(value: boolean) {
      held = value;
    },
    /** A turn the owner holds for this session. */
    live(session: string) {
      const commandId = randomUUID();
      (
        conversations as unknown as { active: Map<string, LiveTurn> }
      ).active.set(commandId, {
        commandId,
        accepted: { session },
      } as LiveTurn);
    },
  };
}
const code = async (run: () => unknown) => {
  try {
    await run();
  } catch (error) {
    return error instanceof ContractError ? error.code : String(error);
  }
  return "ok";
};

it("a rename is acknowledged once the session shows the name, and the same command observes its original", async () => {
  const f = fixture(),
    [id] = f.ids,
    commandId = randomUUID();
  const file = join(
    f.directory,
    readdirSync(f.directory).find((name) => name.endsWith(`${id}.jsonl`)) ?? "",
  );
  expect(f.title(id)).toBe("Terminal question 000.0");
  expect(await f.rename(id, "Release notes", commandId)).toEqual({
    kind: "accepted",
    commandId,
  });
  // Pi is given the session's own file, directory and recorded cwd.
  expect(child.rename).toHaveBeenCalledTimes(1);
  expect(child.rename.mock.calls[0][0]).toEqual({
    id,
    dir: dirname(file),
    file,
    cwd: f.cwd,
    name: "Release notes",
  });
  expect(f.title(id)).toBe("Release notes");
  // It is the owner's accepted work, settled once the child has closed, and
  // the child may be signalled only while this owner holds its lease.
  expect(await f.tracked.work[0]).toEqual({ status: "settled" });
  expect(f.owner.state).toBe("idle");
  const maySignal = child.rename.mock.calls[0][2] as () => boolean;
  expect(maySignal()).toBe(true);
  f.lease(false);
  expect(maySignal()).toBe(false);
  f.lease(true);
  // A lost reply asks again with the same command: no second entry.
  expect(await f.rename(id, "Release notes", commandId)).toEqual({
    kind: "accepted",
    commandId,
  });
  expect(child.rename).toHaveBeenCalledTimes(1);
  expect(await code(() => f.rename(id, "Something else", commandId))).toBe(
    "conflict",
  );
  // An empty name clears it: the first message titles the session again.
  await f.rename(id, "");
  expect(f.title(id)).toBe("Terminal question 000.0");
});

it("exit zero alone is not a rename: the name must be read back", async () => {
  const f = fixture(),
    [id] = f.ids;
  child.rename.mockImplementation((async () => closed()) satisfies Launch);
  expect(await code(() => f.rename(id, "Never written"))).toBe(
    "receipt-inconclusive",
  );
  expect(f.title(id)).toBe("Terminal question 000.0");
  // Another writer's later name is not this command's either.
  child.rename.mockImplementation((async (target) => {
    record(target);
    record({ ...target, name: "Named in the terminal" });
    return closed();
  }) satisfies Launch);
  expect(await code(() => f.rename(id, "Named in the browser"))).toBe(
    "receipt-inconclusive",
  );
  expect(f.title(id)).toBe("Named in the terminal");
  expect(f.owner.state).toBe("idle");
});

it("a child that fails is unavailable, and one whose closure is unknown leaves uncertain work", async () => {
  const f = fixture(),
    [id] = f.ids;
  for (const outcome of ["failed", "timeout", "canceled"] as const) {
    child.rename.mockImplementation((async () =>
      closed(outcome)) satisfies Launch);
    expect(await code(() => f.rename(id, "Not applied"))).toBe("unavailable");
  }
  // A launch that throws started nothing.
  child.rename.mockImplementation(() => {
    throw Error("spawn");
  });
  expect(await code(() => f.rename(id, "Not applied"))).toBe("unavailable");
  expect(await Promise.all(f.tracked.work)).toEqual(
    Array.from({ length: 4 }, () => ({ status: "settled" })),
  );
  // A child that may still be running is never settled work.
  child.rename.mockImplementation((async () =>
    closed("unknown")) satisfies Launch);
  expect(await code(() => f.rename(id, "Not applied"))).toBe("unavailable");
  expect(await f.tracked.work[4]).toEqual({ status: "uncertain" });
  // The session is free again after every outcome.
  child.rename.mockImplementation(renamed);
  expect(await code(() => f.rename(id, "Applied"))).toBe("ok");
});

it("refuses before any child: no session, a live turn, a name reads would redact, an unhealthy owner", async () => {
  const f = fixture(),
    [id, busy] = f.ids,
    before = f.sessionBytes();
  expect(await code(() => f.rename(randomUUID(), "Name"))).toBe("stale");
  f.live(busy);
  expect(await code(() => f.rename(busy, "Name"))).toBe("conflict");
  f.secrets(["fabricated-name-credential"]);
  expect(await code(() => f.rename(id, "Key fabricated-name-credential"))).toBe(
    "forbidden",
  );
  f.owner.state = "quarantined";
  expect(await code(() => f.rename(id, "Name"))).toBe("quarantine");
  expect(await code(() => f.archive(id, true))).toBe("quarantine");
  expect(child.rename).not.toHaveBeenCalled();
  expect(f.tracked.work).toEqual([]);
  expect(f.sessionBytes()).toBe(before);
});

it("one rename per session, a bounded number at once, no Send meanwhile, and Stop reaches the child", async () => {
  const f = fixture(6),
    pending: (() => void)[] = [];
  child.rename.mockImplementation(
    ((target, signal) =>
      new Promise<RunResult>((resolve) => {
        pending.push(() => {
          if (!signal.aborted) record(target);
          resolve(closed(signal.aborted ? "canceled" : "completed"));
        });
      })) satisfies Launch,
  );
  const first = f.rename(f.ids[0], "First");
  expect(await code(() => f.rename(f.ids[0], "Second"))).toBe("conflict");
  // A turn sent now would branch beside the entry being appended.
  expect(
    await code(() =>
      f.conversations.send({
        kind: "send",
        commandId: randomUUID(),
        conversationId: f.ids[0],
        head: null,
        text: "Continue",
        model: {
          epoch: randomUUID(),
          accessGeneration: 1,
          configRev: 1,
          catalogId: randomUUID(),
        },
      } satisfies Extract<WorkbenchCommand, { kind: "send" }>),
    ),
  ).toBe("conflict");
  const others = f.ids.slice(1, 4).map((id) => f.rename(id, "Other"));
  expect(await code(() => f.rename(f.ids[4], "One too many"))).toBe("capacity");
  await vi.waitFor(() => expect(pending).toHaveLength(4));
  // Owner Stop aborts exactly that child, as the service.
  f.tracked.stops[3]();
  const signal = child.rename.mock.calls[3][1] as AbortSignal;
  expect(signal.aborted).toBe(true);
  expect(signal.reason).toMatchObject({ source: "service", reason: "stop" });
  for (const settle of pending) settle();
  expect(await first).toMatchObject({ kind: "accepted" });
  expect(await Promise.allSettled(others)).toMatchObject([
    { status: "fulfilled" },
    { status: "fulfilled" },
    { status: "rejected", reason: { code: "unavailable" } },
  ]);
  expect(f.title(f.ids[0])).toBe("First");
  // Finished renames free both the session and the slots.
  child.rename.mockImplementation(renamed);
  expect(await code(() => f.rename(f.ids[0], "Second"))).toBe("ok");
  expect(await code(() => f.rename(f.ids[4], "Now admitted"))).toBe("ok");
});

it("a refused registration starts no child", async () => {
  const f = fixture(),
    [id] = f.ids,
    before = f.sessionBytes();
  f.owner.refuse = true;
  expect(await code(() => f.rename(id, "Name"))).toBe("quarantine");
  // The launch had not begun: it now sees a signal that is already aborted,
  // which the process runner answers without spawning.
  await vi.waitFor(() => expect(child.rename).toHaveBeenCalledTimes(1));
  expect((child.rename.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  f.owner.refuse = false;
  child.rename.mockImplementation(renamed);
  expect(await code(() => f.rename(id, "Name"))).toBe("ok");
  expect(f.sessionBytes()).not.toBe(before);
});

it("archive is the owner's own record: the list follows it and no session byte changes", async () => {
  const f = fixture(),
    [first, second] = f.ids,
    before = f.sessionBytes();
  const listed = (archived = false) => {
    const page = f.records.list(null, archived);
    if (page.kind !== "conversations") throw Error("listing");
    return page.entries.map((entry) => entry.id).sort();
  };
  expect(await code(() => f.archive(randomUUID(), true))).toBe("stale");
  expect(f.archive(first, true)).toMatchObject({ kind: "accepted" });
  const path = f.records.archivePath(first);
  const saved = readFileSync(path, "utf8");
  expect(JSON.parse(saved)).toEqual({
    schema: "cadence-conversation-archive/1",
    id: first,
    at: expect.any(Number),
  });
  expect(listed()).toEqual(f.ids.filter((id) => id !== first).sort());
  expect(listed(true)).toEqual([first]);
  expect(f.records.summary(first, undefined)).toMatchObject({ archived: true });
  // Saying it again changes nothing.
  expect(f.archive(first, true)).toMatchObject({ kind: "accepted" });
  expect(readFileSync(path, "utf8")).toBe(saved);
  expect(f.archive(first, false)).toMatchObject({ kind: "accepted" });
  expect(existsSync(path)).toBe(false);
  expect(f.archive(first, false)).toMatchObject({ kind: "accepted" });
  expect(listed()).toEqual([...f.ids].sort());
  expect(f.records.summary(first, undefined)).not.toHaveProperty("archived");
  expect(f.sessionBytes()).toBe(before);
  // A record outlives its session only until it is taken back.
  f.archive(second, true);
  for (const name of readdirSync(f.directory))
    if (name.endsWith(`${second}.jsonl`)) rmSync(join(f.directory, name));
  expect(f.archive(second, false)).toMatchObject({ kind: "accepted" });
  expect(existsSync(f.records.archivePath(second))).toBe(false);
  expect(f.owner.state).toBe("idle");
  expect(child.rename).not.toHaveBeenCalled();
});
