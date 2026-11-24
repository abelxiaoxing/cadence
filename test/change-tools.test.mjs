import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { CHANGE_LIMITS, createChangeTools } from "../src/change-tools.mjs";
import { createWorkerToolkit } from "../src/worker-toolkit.mjs";
import { bindWorkerWorkspace } from "../src/worker-workspace.mjs";
import { deliveryFixture } from "./helpers/delivery-fixture.ts";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";

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
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(
      CHANGE_LIMITS.responseBytes,
    );
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
it("nullable wire fields do not invent queries, close work or consume conflicting cursors", async () => {
  const f = fixture();
  const page = await f.call({
    mode: "candidate",
    path: "a.txt",
    cursor: null,
    close: null,
  });
  await expect(
    f.call({ cursor: page.nextCursor, mode: "paths", path: null, close: null }),
  ).rejects.toThrow(/cursor request/i);
  await expect(
    f.call({ cursor: page.nextCursor, unknown: null }),
  ).rejects.toThrow("arguments");
  const next = await f.call({
    cursor: page.nextCursor,
    mode: null,
    path: null,
    close: null,
  });
  expect(next.state).toBe("more");
  expect(
    (
      await f.call({
        cursor: next.nextCursor,
        mode: null,
        path: null,
        close: true,
      })
    ).state,
  ).toBe("closed");
  await expect(f.call({ cursor: next.nextCursor })).rejects.toThrow("consumed");
  await expect(
    f.call({ mode: "paths", close: true, cursor: null }),
  ).rejects.toThrow(/close.*cursor/i);
  expect(
    (await f.collect({ mode: null, path: null, cursor: null, close: null }))
      .text,
  ).toContain("a.txt");
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
    runtime: fixtureRuntime(),
    changes: f.binding,
  });
  owned.push(kit);
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
it("delta scope shows deltaBase..candidate while full scope stays readable, and escaping stays under responseBytes", async () => {
  const f = deliveryFixture();
  writeFileSync(join(f.root, "a.txt"), "round-1\n");
  f.git("add", "--", "a.txt");
  f.git("commit", "-qm", "round 1");
  const deltaBase = f.head(f.root);
  // Heavy JSON escaping + multi-byte UTF-8: quotes, backslashes, control chars, CJK.
  const escapedText = `${'\\"\\\t\r\n\u0007你🚀'.repeat(400)}\n`;
  writeFileSync(join(f.root, "b.txt"), escapedText);
  f.git("add", "--", "b.txt");
  f.git("commit", "-qm", "round 2");
  const candidate = f.head(f.root);

  const kit = createChangeTools({
    root: f.root,
    base: f.base,
    deltaBase,
    candidate,
  });
  owned.push(kit);
  const call = async (args) => {
    const r = await kit.tools[0].execute("id", args);
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(
      CHANGE_LIMITS.responseBytes,
    );
    return JSON.parse(r.content[0].text);
  };
  const collect = async (args) => {
    const pages = [await call(args)];
    while (pages.at(-1).nextCursor)
      pages.push(await call({ cursor: pages.at(-1).nextCursor }));
    return { text: pages.map((p) => p.text).join(""), pages };
  };

  // Delta paths and diff include only b.txt (deltaBase..candidate).
  const deltaPaths = await collect({ mode: "paths", scope: "delta" });
  expect(deltaPaths.text).toContain("b.txt");
  expect(deltaPaths.text).not.toContain("a.txt");
  const deltaDiff = await collect({ mode: "diff", scope: "delta" });
  expect(deltaDiff.text).toContain("b.txt");
  expect(deltaDiff.text).not.toContain("round-1");

  // Full scope remains readable at all times (never locked out by deltaBase).
  const fullPaths = await collect({ mode: "paths", scope: "full" });
  expect(fullPaths.text).toContain("a.txt");
  expect(fullPaths.text).toContain("b.txt");
  const fullDefault = await collect({ mode: "paths" });
  expect(fullDefault.text).toContain("a.txt");
  expect(fullDefault.text).toContain("b.txt");

  // Heavy-escaped candidate content streams losslessly under CHANGE_LIMITS.responseBytes.
  const streamed = await collect({ mode: "candidate", path: "b.txt" });
  expect(streamed.pages.length).toBeGreaterThan(1);
  expect(streamed.text).toBe(escapedText);

  // Invalid scope combinations are refused.
  await expect(
    call({ mode: "candidate", path: "b.txt", scope: "delta" }),
  ).rejects.toThrow(/delta/i);

  const noDeltaKit = createChangeTools({
    root: f.root,
    base: f.base,
    candidate,
  });
  owned.push(noDeltaKit);
  await expect(
    noDeltaKit.tools[0].execute("id", { mode: "paths", scope: "delta" }),
  ).rejects.toThrow(/delta/i);
});
it("frontier scope shows what the target branch gained (frontierBase..base), apart from the candidate's own change", async () => {
  const f = deliveryFixture();
  // The branch moves on: this is what the delivery was replayed onto.
  writeFileSync(join(f.root, "branch.txt"), "gained by the branch\n");
  f.git("add", "--", "branch.txt");
  f.git("commit", "-qm", "the branch moved");
  const base = f.head(f.root);
  writeFileSync(join(f.root, "a.txt"), "the delivery\n");
  f.git("add", "--", "a.txt");
  f.git("commit", "-qm", "the delivery");
  const candidate = f.head(f.root);
  const kit = createChangeTools({
    root: f.root,
    base,
    candidate,
    frontierBase: f.base,
  });
  owned.push(kit);
  const read = async (args) =>
    JSON.parse((await kit.tools[0].execute("id", args)).content[0].text);
  const gained = await read({ mode: "paths", scope: "frontier" });
  expect(gained.text).toContain("branch.txt");
  expect(gained.text).not.toContain("a.txt");
  // The page says which two commits it compared.
  expect(gained).toMatchObject({
    scope: "frontier",
    base: f.base,
    candidate: base,
    frontierBase: f.base,
  });
  expect(
    (await read({ mode: "diff", scope: "frontier", path: "branch.txt" })).text,
  ).toContain("+gained by the branch");
  // The candidate's own change is still the default scope.
  const own = await read({ mode: "paths" });
  expect(own.text).toContain("a.txt");
  expect(own.text).not.toContain("branch.txt");
  expect(own).toMatchObject({ scope: "full", base, candidate });
  await expect(
    read({ mode: "base", path: "a.txt", scope: "frontier" }),
  ).rejects.toThrow(/frontier scopes apply only to paths and diff/u);

  // A branch that did not move has no frontier to read.
  const still = createChangeTools({ root: f.root, base, candidate });
  owned.push(still);
  await expect(
    still.tools[0].execute("id", { mode: "paths", scope: "frontier" }),
  ).rejects.toThrow("the target branch did not move");
  expect(() =>
    createChangeTools({ root: f.root, base, candidate, frontierBase: "main" }),
  ).toThrow("Invalid fixed Git evidence binding");
});
