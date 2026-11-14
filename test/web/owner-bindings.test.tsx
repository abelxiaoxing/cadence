// Real loopback transport with an inert command adapter; no SDK or user data.
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { httpFixture, request } from "../helpers/service-http-fixture.ts";

it.each([
  undefined,
  "older-build",
  JSON.stringify({ kind: "native", contractHash: "0".repeat(64) }),
])(
  "authenticated reads and commands ignore client build metadata (%s)",
  async (build) => {
    const f = await httpFixture();
    const command = vi.fn(async (input, caller) => {
      expect(caller.authority).toBe("browser");
      return { kind: "accepted" as const, commandId: input.commandId };
    });
    f.adapters.workbench = {
      read: () => ({ kind: "conversations", entries: [], next: null }),
      command,
    };
    try {
      const headers: Record<string, string> = {
        Cookie: f.cookie,
        ...(build === undefined ? {} : { "X-Cadence-Build": build }),
      };
      const session = await request(f.origin, "/api/v1/session", { headers });
      expect(session.status).toBe(200);
      const value = JSON.parse(session.text).value;
      expect(value.capabilities.actions).toBe(true);
      expect(value.authority).toBe("browser");
      const input = {
        kind: "conversation-archive",
        commandId: randomUUID(),
        conversationId: randomUUID(),
        archived: true,
      };
      const controls = {
        ...headers,
        Origin: f.origin,
        "Content-Type": "application/json",
        "X-Cadence-CSRF": value.csrf,
        "X-Cadence-Attachment": String(session.headers["x-cadence-attachment"]),
      };
      const post = (override = {}) =>
        request(f.origin, "/api/v1/workbench/command", {
          method: "POST",
          headers: { ...controls, ...override },
          body: JSON.stringify(input),
        });
      expect((await post()).status).toBe(200);
      expect(command).toHaveBeenCalledTimes(1);
      // A build header can neither grant native authority nor bypass access.
      for (const override of [
        { Cookie: "invalid" },
        { Origin: "https://foreign.invalid" },
        { "X-Cadence-CSRF": randomUUID() },
      ])
        expect((await post(override)).status).not.toBe(200);
      const nativeOnly = await request(f.origin, "/api/v1/workbench/command", {
        method: "POST",
        headers: controls,
        body: JSON.stringify({
          kind: "workflow",
          commandId: randomUUID(),
          epoch: f.epoch,
          request: { action: "cancel", runId: randomUUID() },
        }),
      });
      expect(nativeOnly.status).toBe(403);
      expect(command).toHaveBeenCalledTimes(1);
    } finally {
      await f.server.close();
    }
  },
);
