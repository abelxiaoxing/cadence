// @module-tag slow
// The real rename child (Pi's own SessionManager in a spawned Node) against
// fabricated session files, then a generated owner renaming and archiving over
// HTTP. Run file-targeted; it is not part of the gate.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  WorkbenchCommand,
  WorkbenchRead,
} from "../src/service/contracts/workbench.ts";
import { PiSessions, sessionDirectory } from "../src/service/pi-sessions.ts";
import { renameSession } from "../src/subagent-process.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { seedPiSessions } from "./helpers/retained-conversations.ts";

const script = fileURLToPath(
  new URL("../src/session-rename.mjs", import.meta.url),
);
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const at = new Date(1_800_000_000_000).toISOString();
let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "session-rename-")));
  mkdirSync(join(root, "home"));
  // The child inherits only this isolated home, never the developer's.
  vi.stubEnv("HOME", join(root, "home"));
});
afterEach(() => vi.unstubAllEnvs());

/** One session as Pi writes it: a header, a question and a reply. */
function session(version = 3) {
  const id = randomUUID(),
    dir = join(root, "sessions"),
    cwd = join(root, "project");
  mkdirSync(dir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const file = join(dir, `2026-11-02T00-00-00-000Z_${id}.jsonl`);
  const body =
    line({ type: "session", version, id, timestamp: at, cwd }) +
    line({
      type: "message",
      id: "aaaaaaaa",
      parentId: null,
      timestamp: at,
      message: {
        role: "user",
        content: [{ type: "text", text: "First question" }],
        timestamp: 0,
      },
    }) +
    line({
      type: "message",
      id: "bbbbbbbb",
      parentId: "aaaaaaaa",
      timestamp: at,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Answer" }],
        stopReason: "stop",
        timestamp: 0,
      },
    });
  writeFileSync(file, body);
  return { id, dir, cwd, file, body };
}
async function rename(
  s: { id: string; dir: string; file: string; cwd: string },
  name: string,
) {
  const target = { id: s.id, dir: s.dir, file: s.file, cwd: s.cwd, name };
  return {
    result: await renameSession(
      target,
      new AbortController().signal,
      () => true,
    ),
  };
}
const summary = (s: { id: string; dir: string; cwd: string }) =>
  new PiSessions(s.dir, s.cwd).find(s.id)?.summary;

it("Pi appends exactly one name entry at the session's end; an empty name clears it", async () => {
  const s = session();
  const first = await rename(s, "Named 改名 from the browser");
  expect(first.result).toMatchObject({
    outcome: "completed",
    closed: true,
    exitCode: 0,
    output: "",
  });
  const after = readFileSync(s.file, "utf8");
  expect(after.startsWith(s.body)).toBe(true);
  const added = after.slice(s.body.length);
  expect(added.endsWith("\n")).toBe(true);
  const entry = JSON.parse(added);
  expect(entry).toEqual({
    type: "session_info",
    id: expect.stringMatching(/^[0-9a-f]{8}$/),
    parentId: "bbbbbbbb",
    timestamp: expect.any(String),
    name: "Named 改名 from the browser",
  });
  expect(summary(s)).toMatchObject({
    name: "Named 改名 from the browser",
    leaf: entry.id,
    firstUser: "First question",
  });
  expect((await rename(s, "")).result.outcome).toBe("completed");
  const cleared = readFileSync(s.file, "utf8");
  expect(cleared.startsWith(after)).toBe(true);
  expect(JSON.parse(cleared.slice(after.length))).toMatchObject({
    type: "session_info",
    parentId: entry.id,
    name: "",
  });
  expect(summary(s)?.name).toBeNull();
  expect(readdirSync(s.dir)).toHaveLength(1);
}, 20000);

it("a torn last line is ended, never repaired or dropped, before the entry is appended", async () => {
  const s = session();
  const torn = '{"type":"message","id":"cccccccc","parentId":"bbbb';
  appendFileSync(s.file, torn);
  expect((await rename(s, "After a crash")).result.outcome).toBe("completed");
  const after = readFileSync(s.file, "utf8");
  expect(after.startsWith(`${s.body}${torn}\n`)).toBe(true);
  // The torn line is not an entry, so the name continues the last whole one.
  expect(
    JSON.parse(after.slice(s.body.length + torn.length + 1)),
  ).toMatchObject({
    type: "session_info",
    parentId: "bbbbbbbb",
    name: "After a crash",
  });
  expect(summary(s)?.name).toBe("After a crash");
}, 20000);

it("refuses another identity, an older format and an empty or missing file, leaving every byte as it was", async () => {
  const s = session();
  const mismatch = await rename({ ...s, id: randomUUID() }, "Wrong");
  expect(mismatch.result).toMatchObject({
    outcome: "failed",
    closed: true,
    exitCode: 1,
  });
  expect(mismatch.result.output).toContain("session-rename: session-mismatch");
  expect(readFileSync(s.file, "utf8")).toBe(s.body);
  // Pi would migrate (rewrite) an older session on open.
  const old = session(2);
  const older = await rename(old, "Wrong");
  expect(older.result.output).toContain("session-rename: session-mismatch");
  expect(readFileSync(old.file, "utf8")).toBe(old.body);
  // Pi would write a new header into an empty file.
  const empty = session();
  writeFileSync(empty.file, "");
  expect((await rename(empty, "Wrong")).result.outcome).toBe("failed");
  expect(readFileSync(empty.file, "utf8")).toBe("");
  // Pi would treat a missing path as a new session.
  const missing = { ...s, file: join(s.dir, "absent.jsonl") };
  const absent = await rename(missing, "Wrong");
  expect(absent.result.output).toContain("session-rename: session-unreadable");
  expect(existsSync(missing.file)).toBe(false);
  expect(readdirSync(s.dir)).toHaveLength(3);
  // No refusal echoes the name, a path or an exception.
  for (const run of [mismatch, older, absent])
    expect(run.result.output).not.toMatch(/Wrong|sessions|Error/);
}, 30000);

it("runs only as the owner's guarded child", () => {
  const s = session();
  const run = spawnSync(process.execPath, [script], {
    input: JSON.stringify({
      id: s.id,
      dir: s.dir,
      file: s.file,
      cwd: s.cwd,
      name: "Unguarded",
    }),
    env: { PATH: process.env.PATH, HOME: join(root, "home") },
    encoding: "utf8",
  });
  expect(run.status).toBe(1);
  expect(run.stderr).toBe("session-rename: guards-required\n");
  expect(readFileSync(s.file, "utf8")).toBe(s.body);
});

it("a running owner renames and archives over HTTP: one Pi entry, the lists follow, restart keeps the record", async () => {
  const f = await acceptingFixture("generated");
  try {
    expect((await f.client.session()).kind).toBe("ok");
    const directory = sessionDirectory(f.root, join(f.dir, "agent"), {});
    const seeded = seedPiSessions(directory, f.root, 3);
    const [first, second] = seeded.ids;
    const file = (id: string) =>
      join(
        directory,
        readdirSync(directory).find((name) => name.endsWith(`${id}.jsonl`)) ??
          "",
      );
    let client = f.client;
    const read = async (request: WorkbenchRead) => {
      const reply = await client.workbenchRead(request);
      if (reply.kind !== "ok") throw Error(JSON.stringify(reply));
      return reply.value;
    };
    const command = (request: WorkbenchCommand) =>
      client.workbenchCommand(request);
    const listed = async (archived?: true) => {
      const page = await read({
        kind: "conversations",
        ...(archived ? { archived } : {}),
      });
      if (page.kind !== "conversations") throw Error("listing");
      return page.entries;
    };
    const head = async (id: string) => {
      const view = await read({
        kind: "conversation",
        id,
        leaf: null,
        known: seeded.longLeaf,
      });
      if (view.kind !== "conversation") throw Error("head");
      return view;
    };
    const before = readFileSync(file(first), "utf8"),
      untouched = readFileSync(file(second));
    const commandId = randomUUID();
    const rename = {
      kind: "conversation-rename",
      commandId,
      conversationId: first,
      name: "Renamed 改名",
    } as const;
    const accepted = { kind: "ok", value: { kind: "accepted", commandId } };
    expect(await command(rename)).toEqual(accepted);
    const after = readFileSync(file(first), "utf8");
    expect(after.startsWith(before)).toBe(true);
    const added = after
      .slice(before.length)
      .trimEnd()
      .split("\n")
      .map((text) => JSON.parse(text));
    expect(added).toMatchObject([
      { type: "session_info", parentId: seeded.longLeaf, name: "Renamed 改名" },
    ]);
    // The newest write heads the history, under its new title.
    expect((await listed())[0]).toMatchObject({
      id: first,
      title: "Renamed 改名",
    });
    expect(await head(first)).toMatchObject({
      summary: { title: "Renamed 改名", leaf: added[0].id },
      leaf: added[0].id,
      continues: true,
      branches: 1,
      turns: 1,
    });
    // A lost reply asks again: the original answer, and no second entry.
    expect(await command(rename)).toEqual(accepted);
    expect(readFileSync(file(first), "utf8")).toBe(after);
    expect(await command({ ...rename, name: "Other" })).toMatchObject({
      kind: "error",
      error: { code: "conflict" },
    });
    expect(
      await command({
        ...rename,
        commandId: randomUUID(),
        conversationId: randomUUID(),
      }),
    ).toMatchObject({ kind: "error", error: { code: "stale" } });
    expect(
      await command({ ...rename, commandId: randomUUID(), name: "" }),
    ).toMatchObject({ kind: "ok" });
    expect((await head(first)).summary?.title).toBe("Terminal question 000.0");
    // Archive: the owner's record only.
    const archive = (archived: boolean) =>
      command({
        kind: "conversation-archive",
        commandId: randomUUID(),
        conversationId: second,
        archived,
      });
    expect(await archive(true)).toMatchObject({ kind: "ok" });
    expect((await listed()).map((entry) => entry.id)).not.toContain(second);
    expect(await listed(true)).toMatchObject([{ id: second, archived: true }]);
    expect((await head(second)).summary).toMatchObject({ archived: true });
    expect(readFileSync(file(second))).toEqual(untouched);
    client = (await f.restart()).client;
    expect((await listed()).map((entry) => entry.id)).not.toContain(second);
    expect(await archive(false)).toMatchObject({ kind: "ok" });
    expect((await listed()).map((entry) => entry.id)).toContain(second);
    expect(await listed(true)).toEqual([]);
    expect(readFileSync(file(second))).toEqual(untouched);
    expect(readdirSync(directory)).toHaveLength(3);
  } finally {
    await f.close();
  }
}, 30000);
