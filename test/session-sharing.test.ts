import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  CONTINUED_ELSEWHERE,
  registerSessionSharing,
} from "../src/session-sharing.ts";

it("a terminal is told once when the browser continued its open session, never for its own entries", () => {
  const file = join(mkdtempSync(join(tmpdir(), "sharing-")), "s.jsonl");
  const line = (value: unknown) => `${JSON.stringify(value)}\n`;
  writeFileSync(
    file,
    line({ type: "session", version: 3, id: "s", cwd: "/p" }) +
      line({ type: "message", id: "a1", parentId: null }),
  );
  const own = new Set(["a1"]);
  const notices: string[] = [];
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const ctx = {
    hasUI: true,
    sessionManager: {
      getSessionFile: () => file,
      getEntry: (id: string) => (own.has(id) ? { id } : undefined),
    },
    ui: { notify: (text: string) => notices.push(text) },
  };
  registerSessionSharing({
    on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) =>
      handlers.set(name, handler),
  } as never);
  const fire = (name: string) => handlers.get(name)?.({}, ctx);
  fire("session_start");
  expect(notices).toEqual([]);
  // The terminal's own appended entry is known to its session manager.
  own.add("a2");
  appendFileSync(file, line({ type: "message", id: "a2", parentId: "a1" }));
  fire("agent_settled");
  expect(notices).toEqual([]);
  // The browser appended two entries; a torn third waits for its newline.
  appendFileSync(
    file,
    line({ type: "message", id: "b1", parentId: "a2" }) +
      line({ type: "message", id: "b2", parentId: "b1" }) +
      '{"type":"message","id":"b3"',
  );
  fire("before_agent_start");
  fire("before_agent_start");
  expect(notices).toEqual([CONTINUED_ELSEWHERE]);
  appendFileSync(file, `,"parentId":"b2"}\n`);
  fire("agent_settled");
  expect(notices).toHaveLength(2);
  // A name recorded from the browser continues nothing: no notice.
  appendFileSync(
    file,
    line({ type: "session_info", id: "n1", parentId: "b3", name: "Renamed" }),
  );
  fire("agent_settled");
  expect(notices).toHaveLength(2);
  // A context without a session file (or an older Pi) is simply not observed.
  handlers.get("session_start")?.({}, { hasUI: true, sessionManager: {} });
  fire("session_shutdown");
});
