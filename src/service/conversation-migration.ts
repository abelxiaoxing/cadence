/** Explicit, one-way copy of the browser conversations Cadence kept itself
 * before the project's Pi sessions became the shared conversation store. Each
 * becomes a Pi session file with the same id, holding the context its last
 * completed reply continued from; the old store is never changed or removed. */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  opendirSync,
  openSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { iterateConversationContext } from "../conversation-context.mjs";
import { WEBUI_SESSION_ENTRY } from "../session-entries.mjs";
import { ContractError, decodeId, parseWireJson } from "./contracts/core.ts";
import type { ServiceCoordination } from "./coordination.ts";
import type { ServiceOwner } from "./owner.ts";
import type { PiSessions } from "./pi-sessions.ts";

const META_BYTES = 64 * 1024;
interface Legacy {
  id: string;
  /** The turn whose completed reply holds the conversation's context. */
  checkpoint: string;
}
export class ConversationMigration {
  private readonly root: string;
  constructor(
    private readonly o: {
      coordination: ServiceCoordination;
      owner: ServiceOwner;
      cwd: string;
      sessions: PiSessions;
    },
  ) {
    this.root = join(o.coordination.directory, "conversations-v1");
  }
  private read(path: string): unknown | undefined {
    const file = this.o.coordination.files.read(path, META_BYTES);
    return file
      ? parseWireJson(file.bytes.toString("utf8"), META_BYTES)
      : undefined;
  }
  /** This project's old conversations that hold a context to copy. One that
   * cannot be read is not listed and stays where it is. */
  private legacy(): Legacy[] {
    const dir = join(this.root, "sessions");
    if (!this.o.coordination.files.directory(dir)) return [];
    const out: Legacy[] = [];
    const handle = opendirSync(dir);
    try {
      for (let e = handle.readSync(); e; e = handle.readSync()) {
        try {
          if (!e.isFile() || !e.name.endsWith(".json")) continue;
          const id = decodeId(e.name.slice(0, -5));
          const identity = this.read(
            join(this.root, "identities", `${id}.json`),
          );
          if (
            !identity ||
            typeof identity !== "object" ||
            (identity as Record<string, unknown>).schema !==
              "cadence-conversation/1" ||
            (identity as Record<string, unknown>).id !== id ||
            (identity as Record<string, unknown>).cwd !== this.o.cwd
          )
            continue;
          const meta = this.read(join(dir, e.name));
          const checkpoint =
            meta && typeof meta === "object"
              ? (meta as Record<string, unknown>).checkpoint
              : null;
          if (typeof checkpoint === "string")
            out.push({ id, checkpoint: decodeId(checkpoint) });
        } catch {
          // An unreadable record is left for a later explicit attempt.
        }
      }
    } finally {
      handle.closeSync();
    }
    return out;
  }
  /** Old conversations that no Pi session holds yet. */
  pending(): number {
    this.o.owner.lease.assert();
    const sessions = new Set(this.o.sessions.list().map((l) => l.summary.id));
    return this.legacy().filter((c) => !sessions.has(c.id)).length;
  }
  migrate(): { migrated: number; skipped: number } {
    this.o.owner.lease.assert();
    if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
    const sessions = new Set(this.o.sessions.list().map((l) => l.summary.id));
    let migrated = 0,
      skipped = 0;
    for (const conversation of this.legacy()) {
      if (sessions.has(conversation.id)) continue;
      try {
        this.copy(conversation);
        migrated++;
      } catch {
        skipped++;
      }
    }
    return { migrated, skipped };
  }
  private copy(conversation: Legacy): void {
    const messages = [
      ...iterateConversationContext(
        join(this.root, "turns", conversation.checkpoint, "context.json"),
      ),
    ] as {
      role: string;
      timestamp: number;
      provider?: string;
      model?: string;
    }[];
    if (!messages.length) throw new ContractError("invalid");
    const first = messages[0].timestamp || Date.now();
    const iso = (ms: number) => new Date(ms || first).toISOString();
    const ids = new Set<string>();
    const nextId = () => {
      for (;;) {
        const id = randomBytes(4).toString("hex");
        if (!ids.has(id)) {
          ids.add(id);
          return id;
        }
      }
    };
    let parentId: string | null = null;
    const lines = [
      {
        type: "session",
        version: 3,
        id: conversation.id,
        timestamp: iso(first),
        cwd: this.o.cwd,
      },
    ];
    const append = (entry: Record<string, unknown>) => {
      const id = nextId();
      lines.push({ ...entry, id, parentId } as never);
      parentId = id;
    };
    append({
      type: "custom",
      customType: WEBUI_SESSION_ENTRY,
      timestamp: iso(first),
    });
    const assistant = messages.find((m) => m.role === "assistant");
    if (assistant?.provider && assistant.model)
      append({
        type: "model_change",
        timestamp: iso(first),
        provider: assistant.provider,
        modelId: assistant.model,
      });
    for (const message of messages)
      append({ type: "message", timestamp: iso(message.timestamp), message });
    const name = `${iso(first).replace(/[:.]/g, "-")}_${conversation.id}.jsonl`;
    const directory = this.o.sessions.directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = join(
      directory,
      `.${name}.${randomBytes(6).toString("hex")}`,
    );
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeSync(
        fd,
        `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      // A link never replaces a session that appeared meanwhile.
      linkSync(temporary, join(directory, name));
    } finally {
      unlinkSync(temporary);
    }
  }
}
