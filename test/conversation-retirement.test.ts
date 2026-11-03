import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  decodeWorkbenchCommand,
  decodeWorkbenchRead,
  decodeWorkbenchResult,
} from "../src/service/contracts/workbench.ts";
import { ConversationContextRecords } from "../src/service/conversation-contexts.ts";
import { ConversationControls } from "../src/service/conversation-controls.ts";
import { ConversationRecords } from "../src/service/conversation-records.ts";
import type { ServiceCoordination } from "../src/service/coordination.ts";
import { sessionDirectory } from "../src/service/pi-sessions.ts";
import { PrivateFiles } from "../src/service/private-files.ts";
import { seedPiSessions } from "./helpers/retained-conversations.ts";

it.each(["identities", "sessions"])(
  "retired %s are preserved and cannot be reopened or silently rebound",
  (kind) => {
    const root = mkdtempSync(join(tmpdir(), "retired-conversation-"));
    const cwd = join(root, "project"),
      agentDir = join(root, "agent");
    mkdirSync(cwd);
    mkdirSync(agentDir);
    const coordination = {
      directory: join(root, "service-v1"),
      files: new PrivateFiles(root),
      store: { root: cwd },
    } as unknown as ServiceCoordination;
    const seeded = seedPiSessions(sessionDirectory(cwd, agentDir, {}), cwd, 2);
    const id = seeded.ids[0],
      oldPath = join(
        coordination.directory,
        "conversations-v1",
        kind,
        `${id}.json`,
      );
    // Deliberately opaque: retirement has no old schema decoder or repair path.
    const oldBytes =
      "retired data, including partially written records {" +
      "x".repeat(1024 * 1024);
    coordination.files.create(oldPath, oldBytes, 2 * 1024 * 1024);
    const records = new ConversationRecords({
      coordination,
      cwd,
      agentDir,
      assertCurrent() {},
      secrets: () => [],
    });
    const contexts = new ConversationContextRecords(
      coordination,
      records.sessions,
    );
    const controls = new ConversationControls({
      directory: coordination.directory,
      files: coordination.files,
      conversations: records,
      assertCurrent() {},
    });
    for (const read of [
      () => records.conversation(id, null, null),
      () => contexts.read({ id, cwd }),
      () => controls.state(id),
      () => records.controlPath(id),
    ])
      expect(read).toThrow("retired-conversation");
    const list = records.list(null),
      view = records.conversation(seeded.ids[1], null, null);
    if (list.kind !== "conversations" || view.kind !== "conversation")
      throw Error("view");
    expect(list.entries.map((row) => row.id)).toEqual([seeded.ids[1]]);
    expect(view.turns).toBe(1);
    expect(readFileSync(oldPath, "utf8")).toBe(oldBytes);
    expect(
      existsSync(join(coordination.directory, "conversation-commands-v1")),
    ).toBe(false);
    expect(existsSync(contexts.path(id))).toBe(false);
  },
);
it("retired migration and task-origin operations are absent from the closed protocol", () => {
  expect(() => decodeWorkbenchRead({ kind: "conversation-legacy" })).toThrow();
  expect(() =>
    decodeWorkbenchRead({ kind: "task-origin", taskId: randomUUID() }),
  ).toThrow();
  expect(() =>
    decodeWorkbenchCommand({
      kind: "conversation-migrate",
      commandId: randomUUID(),
    }),
  ).toThrow();
  expect(() =>
    decodeWorkbenchResult({
      kind: "conversation-migrated",
      commandId: randomUUID(),
      migrated: 1,
      skipped: 0,
    }),
  ).toThrow();
});
