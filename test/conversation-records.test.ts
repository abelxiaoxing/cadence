import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ConversationRecords } from "../src/service/conversation-records.ts";
import type { LiveTurn } from "../src/service/conversations.ts";
import type { ServiceCoordination } from "../src/service/coordination.ts";
import { sessionDirectory } from "../src/service/pi-sessions.ts";
import { PrivateFiles } from "../src/service/private-files.ts";
import { seedPiSessions } from "./helpers/retained-conversations.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "conversation-records-"));
  const cwd = join(root, "project"),
    agentDir = join(root, "agent");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  const coordination = {
    directory: join(root, "service-v1"),
    files: new PrivateFiles(root),
    store: { root: cwd },
  } as unknown as ServiceCoordination;
  let secrets: string[] = [];
  const active = new Map<string, LiveTurn>();
  const records = new ConversationRecords({
    coordination,
    cwd,
    agentDir,
    active,
    assertCurrent() {},
    secrets: () => secrets,
  });
  const write = (path: string, value: unknown) =>
    coordination.files.create(path, JSON.stringify(value));
  const command = (
    id: string,
    status: string,
    user: string | null,
    text = "Question",
    notice = "",
    parent: string | null = null,
  ) => {
    const commandId = randomUUID();
    write(records.path(commandId, "accepted.json"), {
      command: {
        kind: "send",
        commandId,
        conversationId: id,
        head: parent,
        text,
        model: {
          epoch: randomUUID(),
          accessGeneration: 1,
          configRev: 1,
          catalogId: randomUUID(),
        },
      },
      at: 1,
      session: id,
      parent,
      offset: 0,
    });
    write(records.path(commandId, "state.json"), {
      status,
      notice,
      user,
      omitted: { thinking: false, media: false, other: false },
    });
    write(records.indexPath(id), {
      schema: "cadence-session-commands/1",
      id,
      commands: [commandId],
    });
    return commandId;
  };
  return {
    records,
    active,
    cwd,
    agentDir,
    command,
    secrets(value: string[]) {
      secrets = value;
    },
  };
}
it("failed attempts reapply current read redaction without changing the stored admission", () => {
  const f = fixture(),
    id = randomUUID(),
    secret = "fabricated-new-credential";
  const command = f.command(
    id,
    "failed",
    null,
    `Remember ${secret}`,
    `Failure ${secret}`,
  );
  const path = f.records.path(command, "accepted.json"),
    before = readFileSync(path);
  f.secrets([secret]);
  const view = f.records.conversation(id, null, null);
  expect(JSON.stringify(view)).not.toContain(secret);
  expect(view).toMatchObject({
    attempt: { text: "Remember [redacted]", notice: "Failure [redacted]" },
  });
  expect(readFileSync(path)).toEqual(before);
});
it.each(["failed", "unknown", "timeout", "canceled"])(
  "summary and turn both retain the owner's %s outcome",
  (status) => {
    const f = fixture();
    const session = seedPiSessions(
      sessionDirectory(f.cwd, f.agentDir),
      f.cwd,
      1,
    );
    f.command(session.ids[0], status, "00000001", "Terminal question 000.0");
    expect(f.records.conversation(session.ids[0], null, null)).toMatchObject({
      summary: { status },
    });
    expect(
      f.records.turnSteps(session.ids[0], session.longLeaf, 0, null),
    ).toMatchObject({ turn: { status } });
  },
);
it("a failed attempt from the current leaf is not masked by its previous completed Pi reply", () => {
  const f = fixture(),
    seed = seedPiSessions(sessionDirectory(f.cwd, f.agentDir), f.cwd, 1);
  f.command(
    seed.ids[0],
    "failed",
    null,
    "Never reached Pi",
    "auth-unavailable",
    seed.longLeaf,
  );
  expect(f.records.conversation(seed.ids[0], null, null)).toMatchObject({
    summary: { status: "failed" },
    attempt: { status: "failed" },
  });
});

it("an unwritten live Send also applies current read redaction", () => {
  const f = fixture(),
    id = randomUUID(),
    secret = "new-live-credential";
  const commandId = f.command(id, "queued", null, `Question ${secret}`),
    accepted = f.records.accepted(commandId);
  if (!accepted) throw Error("admission");
  f.active.set(commandId, {
    commandId,
    accepted,
    epoch: randomUUID(),
    title: `Question ${secret}`,
    execution: {
      cwd: f.cwd,
      checkoutRoot: f.cwd,
      model: null,
      version: accepted.command.model,
    },
    state: {
      status: "queued",
      notice: "",
      user: null,
      omitted: { thinking: false, media: false, other: false },
    },
    stateFile: null,
    capture: null,
    abort: new AbortController(),
    original: new Promise(() => {}),
  });
  f.secrets([secret]);
  const head = f.records.conversation(id, null, null),
    turn = f.records.turnSteps(id, null, 0, null);
  expect(JSON.stringify([head, turn])).not.toContain(secret);
  expect(turn).toMatchObject({
    steps: [{ text: "Question [redacted]" }],
  });
});
