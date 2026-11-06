import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { ServiceHttpServer } from "../src/service/http.ts";

it("owner activity is an authenticated readonly local query, not a browser capability or attachment", async () => {
  const epoch = randomUUID();
  const invoke = vi.fn(() => ({
    kind: "owner-activity",
    epoch,
    activities: [],
  }));
  const authenticate = vi.fn(
    (_boundary: unknown, _id: string, _write: boolean) => ({
      authority: "local",
    }),
  );
  const server = {
    options: {
      auth: { authenticate, current: vi.fn() },
      management: { invoke },
    },
  };
  const req = { url: "/local/v1/admin/activity", method: "GET", headers: {} };
  const end = vi.fn();
  const res = {
    destroyed: false,
    writableEnded: false,
    setHeader: vi.fn(),
    end,
  };
  const manage = (ServiceHttpServer.prototype as any).manage;
  await manage.call(server, req, res, {}, new AbortController().signal);
  expect(authenticate.mock.calls[0]?.[2]).toBe(false);
  expect(invoke).toHaveBeenCalledWith("activity");
  expect(JSON.parse(end.mock.calls[0][0]).value.epoch).toBe(epoch);
  authenticate.mockReturnValue({ authority: "browser" });
  await expect(
    manage.call(server, req, res, {}, new AbortController().signal),
  ).rejects.toThrow("forbidden");
  authenticate.mockReturnValue({ authority: "local" });
  await expect(
    manage.call(
      server,
      { ...req, method: "POST" },
      res,
      {},
      new AbortController().signal,
    ),
  ).rejects.toThrow("invalid");
  await expect(
    manage.call(
      server,
      { ...req, headers: { "content-length": "2" } },
      res,
      {},
      new AbortController().signal,
    ),
  ).rejects.toThrow("invalid");
  expect(invoke).toHaveBeenCalledTimes(1);
});
