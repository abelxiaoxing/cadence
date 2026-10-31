/** A native attachment is forgotten only when the registry proves its owner gone. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { NativeConnection, projectStopCommand } from "../src/native-client.ts";

afterEach(() => vi.unstubAllEnvs());

it("forgets an attachment whose owner is no longer registered, without a detach request", async () => {
  vi.stubEnv("XDG_STATE_HOME", mkdtempSync(join(tmpdir(), "cadence-state-")));
  const project = mkdtempSync(join(tmpdir(), "cadence-project-"));
  const connection = new NativeConnection();
  expect(connection.forgetSuperseded(project)).toBe(false);
  const detach = vi.fn(async () => {
    throw new Error("owner gone");
  });
  const close = vi.fn(async () => {});
  Object.assign(connection as object, {
    transport: { detach },
    network: { close },
    epoch: "11111111-1111-4111-8111-111111111111",
    client: {},
    session: {},
  });
  expect(connection.forgetSuperseded(project)).toBe(true);
  expect(connection.client).toBeUndefined();
  expect(connection.session).toBeUndefined();
  expect(detach).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
  // Nothing remains to detach, so a later attach is not blocked.
  await expect(connection.detach()).resolves.toBeUndefined();
});
it("names the explicit per-project stop command", () => {
  expect(projectStopCommand("/w")).toMatch(/ stop --workspace "\/w"$/);
});
