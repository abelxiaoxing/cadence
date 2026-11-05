import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createChangeTools } from "../src/change-tools.mjs";
import { createWorkerToolkit } from "../src/worker-toolkit.mjs";
import { bindWorkerWorkspace } from "../src/worker-workspace.mjs";
import { deliveryFixture } from "./helpers/delivery-fixture.ts";

const owned = [];
afterEach(async () => {
  await Promise.all(owned.splice(0).map((kit) => kit.close()));
});
function fixture() {
  const f = deliveryFixture();
  const text = `${"x".repeat(2047)}你\n\uFEFFevidence\n`.repeat(12);
  writeFileSync(join(f.root, "a.txt"), text);
  f.git("add", "--", "a.txt");
  f.git("commit", "-qm", "candidate");
  const binding = { root: f.root, base: f.base, candidate: f.head(f.root) };
  const kit = createChangeTools(binding);
  owned.push(kit);
  const call = async (args, signal) => {
    const r = await kit.tools[0].execute("id", args, signal);
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(32768);
    return JSON.parse(r.content[0].text);
  };
  const collect = async (args) => {
    const pages = [await call(args)];
    while (pages.at(-1).nextCursor) {
      expect(pages.length).toBeLessThan(100);
      pages.push(await call({ cursor: pages.at(-1).nextCursor }));
    }
    return { text: pages.map((p) => p.text).join(""), pages };
  };
  return { ...f, binding, text, kit, call, collect };
}
it("fixed Git content streams real continuations, retains split UTF-8/BOM, and does not follow later HEAD movement", async () => {
  const f = fixture();
  writeFileSync(join(f.root, "a.txt"), "later uncommitted user text");
  const result = await f.collect({ mode: "candidate", path: "a.txt" });
  expect(result.text).toBe(f.text);
  expect(result.pages.length).toBeGreaterThan(1);
  expect(result.pages[0].coverage.complete).toBe(false);
  expect(result.pages.at(-1).coverage.complete).toBe(true);
  expect((await f.collect({ mode: "base", path: "a.txt" })).text).toBe(
    "before\n",
  );
  expect((await f.collect({ mode: "diff", path: "a.txt" })).text).toContain(
    "-before",
  );
  expect((await f.collect({ mode: "paths" })).text).toContain("a.txt");
});
it("queries cannot escape the bound path/revisions or rebind/consume a cursor twice", async () => {
  const f = fixture(),
    page = await f.call({ mode: "candidate", path: "a.txt" });
  for (const args of [
    { cursor: page.nextCursor, path: "other" },
    { mode: "diff", base: "HEAD" },
    { mode: "base", path: "../outside" },
    { mode: "candidate", path: "/etc/passwd" },
  ])
    await expect(f.call(args)).rejects.toThrow();
  const next = await f.call({ cursor: page.nextCursor });
  await expect(f.call({ cursor: page.nextCursor })).rejects.toThrow("consumed");
  expect((await f.call({ cursor: next.nextCursor, close: true })).state).toBe(
    "closed",
  );
  await expect(f.call({ cursor: next.nextCursor })).rejects.toThrow("consumed");
});
it("missing and binary objects refuse complete coverage; explicit close joins active Git work", async () => {
  const f = fixture();
  await expect(f.call({ mode: "candidate", path: "missing" })).rejects.toThrow(
    "unavailable",
  );
  writeFileSync(join(f.root, "binary"), Buffer.from([0, 255]));
  f.git("add", "binary");
  f.git("commit", "-qm", "binary");
  const kit = createChangeTools({ ...f.binding, candidate: f.head(f.root) });
  owned.push(kit);
  await expect(
    kit.tools[0].execute("id", { mode: "candidate", path: "binary" }),
  ).rejects.toThrow("Binary");
  const running = f.call({ mode: "candidate", path: "a.txt" }).catch((e) => e);
  await f.kit.close();
  await running;
  await expect(f.call({ mode: "paths" })).rejects.toThrow("closed");
});
it("the registry grants changes only to a review bound to its admitted investigation root", async () => {
  const f = fixture(),
    workspace = bindWorkerWorkspace(f.root);
  const kit = createWorkerToolkit({
    workspace,
    purpose: "review",
    changes: f.binding,
  });
  owned.push(kit);
  expect(kit.capabilities).toEqual(["observation", "changes"]);
  expect(kit.sessionOptions.tools).toContain("changes");
  for (const purpose of ["edit", "research", "diagnosis"])
    expect(() =>
      createWorkerToolkit({ workspace, purpose, changes: f.binding }),
    ).toThrow("binding");
  mkdirSync(join(f.home, "other"));
  expect(() =>
    createWorkerToolkit({
      workspace,
      purpose: "review",
      changes: { ...f.binding, root: join(f.home, "other") },
    }),
  ).toThrow("binding");
});
