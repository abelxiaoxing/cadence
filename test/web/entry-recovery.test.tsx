import { afterEach, expect, it, vi } from "vitest";
import { publicError } from "../../src/service-contract";
import {
  rememberLoginReturn,
  restoreLoginReturn,
} from "../../web/src/client/project-route";
import { readEntry } from "../../web/src/client/workbench-entry";

afterEach(() => vi.unstubAllGlobals());

// The retry lifetime (including hung headers/body, online and departure) is
// exercised against the mounted Workbench hooks in stale-banner.test.tsx.
it.each([401, 403, 502, 200])(
  "does not switch to the direct owner after a %s or malformed entry",
  async (status) => {
    const calls = vi.fn(async () => Response.json({}, { status }));
    vi.stubGlobal("fetch", calls);
    await expect(readEntry(new AbortController().signal)).rejects.toThrow();
    expect(calls).toHaveBeenCalledExactlyOnceWith(
      "/workbench/v1",
      expect.objectContaining({ cache: "no-store" }),
    );
  },
);
it("recognizes the direct owner's definite route refusal", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json(
      { kind: "error", error: publicError("invalid") },
      { status: 400 },
    ),
  );
  expect(await readEntry(new AbortController().signal)).toBeNull();
});
it("after explicit login only restores validated chat/leaf on the same entry once", () => {
  const location = {
    pathname: "/app",
    search: `?project=${"b".repeat(64)}`,
    hash: "#chat=session-A&leaf=abc123ef&extra=discard",
  };
  const storage = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: storage.get.bind(storage),
    setItem: storage.set.bind(storage),
    removeItem: storage.delete.bind(storage),
  });
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", { replaceState: vi.fn(), state: null });
  rememberLoginReturn();
  location.hash = "";
  restoreLoginReturn();
  restoreLoginReturn();
  expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(
    null,
    "",
    "#chat=session-A&leaf=abc123ef",
  );
});
