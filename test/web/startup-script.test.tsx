import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

// Exercise the actual dependency-free script delivered to an old document.
const script = readFileSync("web/dist/assets/start.js", "utf8");
const oldBuild = "a".repeat(64),
  nextBuild = "b".repeat(64);
function page(storage: Map<string, string>, build = nextBuild, status = 200) {
  const handlers = new Map();
  const notice = { hidden: true, querySelector: () => ({}) };
  const document = {
    addEventListener: handlers.set.bind(handlers),
    readyState: "complete",
    getElementById: vi.fn((): typeof notice | null => notice),
  };
  const location = {
    pathname: "/app",
    search: `?project=${"c".repeat(64)}`,
    hash: "#chat=kept",
    reload: vi.fn(),
    replace: vi.fn(),
  };
  const fetch = vi.fn(
    async () =>
      new Response(null, { status, headers: { "X-Cadence-Web-Build": build } }),
  );
  class HTMLScriptElement {
    type = "module";
    constructor(private readonly name: string) {}
    getAttribute() {
      return this.name;
    }
  }
  runInNewContext(script, {
    document,
    HTMLScriptElement,
    location,
    URLSearchParams,
    navigator: { language: "en" },
    fetch,
    sessionStorage: {
      getItem: storage.get.bind(storage),
      setItem: storage.set.bind(storage),
      removeItem: storage.delete.bind(storage),
    },
    AbortController,
    setTimeout,
    clearTimeout,
  });
  const event = (kind: string, name = `/ui/${oldBuild}/assets/cadence.js`) =>
    handlers.get(kind)({ target: new HTMLScriptElement(name) });
  return { location, document, event, fetch, notice };
}
it("rechecks the authenticated document, not an API, and permits just one cache-busted navigation in a failure chain", async () => {
  const storage = new Map();
  const first = page(storage);
  await first.event("error");
  await first.event("error");
  expect(first.fetch).toHaveBeenCalledExactlyOnceWith(
    `/app${first.location.search}`,
    expect.objectContaining({
      cache: "no-store",
      redirect: "error",
      credentials: "same-origin",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    }),
  );
  expect(first.location.replace).toHaveBeenCalledExactlyOnceWith(
    `/app?project=${"c".repeat(64)}&v=${nextBuild}#chat=kept`,
  );
  expect(first.location.reload).not.toHaveBeenCalled();
  expect(first.notice.hidden).toBe(true);
  expect(first.location.hash).toBe("#chat=kept");
  const second = page(storage);
  await second.event("error");
  expect(second.location.replace).not.toHaveBeenCalled();
  expect(second.location.reload).not.toHaveBeenCalled();
  expect(second.notice.hidden).toBe(false);
  await second.event("load");
  expect(storage.size).toBe(0);
});
it("recovers even if the module failure was observed before the body was parsed", async () => {
  const p = page(new Map());
  p.document.readyState = "loading";
  await p.event("error");
  expect(p.fetch).not.toHaveBeenCalled();
  await p.event("DOMContentLoaded");
  expect(p.location.replace).toHaveBeenCalledExactlyOnceWith(
    `/app?project=${"c".repeat(64)}&v=${nextBuild}#chat=kept`,
  );
});
it("refuses automatic navigation without a working cross-reload guard", async () => {
  const storage = new Map<string, string>();
  vi.spyOn(storage, "set").mockImplementation(() => {
    throw Error("blocked");
  });
  const p = page(storage);
  await p.event("error");
  expect(p.notice.hidden).toBe(false);
  expect(p.location.replace).not.toHaveBeenCalled();
  expect(p.location.reload).not.toHaveBeenCalled();
});
it("does not reload on an unchanged build, refused entry, lazy chunk or after mounting", async () => {
  for (const [id, status] of [
    [oldBuild, 200],
    [nextBuild, 401],
  ] as const) {
    const p = page(new Map(), id, status);
    await p.event("error");
    expect(p.location.replace).not.toHaveBeenCalled();
    expect(p.location.reload).not.toHaveBeenCalled();
  }
  const p = page(new Map());
  await p.event("error", `/ui/${oldBuild}/assets/timeline-client.js`);
  p.document.getElementById.mockReturnValueOnce(null);
  await p.event("error");
  expect(p.fetch).not.toHaveBeenCalled();
});
