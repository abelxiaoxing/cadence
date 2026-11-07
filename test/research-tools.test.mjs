import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkerToolkit } from "../src/worker-toolkit.mjs";
import { bindWorkerWorkspace } from "../src/worker-workspace.mjs";

const owned = [];
afterEach(async () => {
  await Promise.all(owned.splice(0).map((kit) => kit.close()));
  vi.unstubAllEnvs();
});
async function fixture(roots) {
  const root = await mkdtemp(join(tmpdir(), "pi-observe-"));
  const kit = createWorkerToolkit({
    purpose: "research",
    workspace: bindWorkerWorkspace(root, roots),
  });
  owned.push(kit);
  const tools = kit.wrap(kit.sessionOptions.customTools);
  const call = (name, args, signal, context) =>
    tools
      .find((tool) => tool.name === name)
      .execute("fixture", args, signal, undefined, context);
  return { root, kit, call };
}
it("ordinary reads use Pi's text and offset/limit protocol, not batches or cursors", async () => {
  const { root, call, kit } = await fixture();
  expect(kit.sessionOptions.tools).toEqual(["read", "grep", "find", "ls"]);
  await writeFile(join(root, "a.txt"), "first\nsecond\nthird");
  const first = await call("read", { path: "a.txt", limit: 1 });
  expect(first.content[0].text).toContain("first");
  expect(first.content[0].text).toContain("offset=2");
  expect(first.content[0].text).not.toContain("nextCursor");
  const rest = await call("read", { path: "a.txt", offset: 2 });
  expect(rest.content[0].text).toBe("second\nthird");
  await expect(call("read", { path: "a.txt", offset: 10 })).rejects.toThrow(
    "beyond end",
  );
});
it("the first investigation root remains the default without rebinding the admitted session cwd", async () => {
  const selected = await mkdtemp(join(tmpdir(), "pi-selected-"));
  await writeFile(join(selected, "a.txt"), "selected source");
  const { root, call, kit } = await fixture([selected]);
  await writeFile(join(root, "a.txt"), "unrelated source");
  expect(kit.sessionOptions.cwd).toBe(root);
  expect(
    (await call("read", { path: "a.txt" }, undefined, { cwd: root })).content[0]
      .text,
  ).toBe("selected source");
  expect((await call("ls", {})).content[0].text).toContain("a.txt");
  expect(
    (await call("read", { path: join(root, "a.txt") })).content[0].text,
  ).toBe("unrelated source");
});
it("absolute paths, tilde, regular aliases and source BOMs retain Pi semantics", async () => {
  const { root, call } = await fixture();
  const home = await mkdtemp(join(tmpdir(), "pi-explicit-"));
  await writeFile(join(home, "external.txt"), "\uFEFFexternal\n\uFEFFsecond");
  vi.stubEnv(process.platform === "win32" ? "USERPROFILE" : "HOME", home);
  expect((await call("read", { path: "~/external.txt" })).content[0].text).toBe(
    "\uFEFFexternal\n\uFEFFsecond",
  );
  expect(
    (await call("read", { path: join(home, "external.txt"), offset: 2 }))
      .content[0].text,
  ).toBe("\uFEFFsecond");
  if (process.platform !== "win32") {
    await symlink(join(home, "external.txt"), join(root, "alias.txt"));
    expect(
      (await call("read", { path: "alias.txt" })).content[0].text,
    ).toContain("external");
  }
});
it("large reads and listings retain SDK truncation notices instead of claiming exhaustive coverage", async () => {
  const { root, call } = await fixture();
  await writeFile(
    join(root, "large.txt"),
    Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n"),
  );
  const page = await call("read", { path: "large.txt" });
  expect(page.details.truncation.truncated).toBe(true);
  expect(page.content[0].text).toContain("offset=2001");
  expect(
    (await call("read", { path: "large.txt", offset: 2001 })).content[0].text,
  ).toContain("line 2499");
  await mkdir(join(root, "directory"));
  const listing = await call("ls", { limit: 1 });
  expect(listing.details.entryLimitReached).toBe(1);
  expect(listing.content[0].text).toContain("limit=2");
});
it("known nonregular read targets refuse without opening them", async () => {
  const { root, call } = await fixture();
  await expect(call("read", { path: root })).rejects.toThrow("regular files");
});
it.skipIf(process.platform === "win32")(
  "a known socket is not opened as a text file",
  async () => {
    const { root, call } = await fixture();
    const server = createServer();
    const path = join(root, "socket");
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    try {
      await expect(call("read", { path })).rejects.toThrow("regular files");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
it.each(["grep", "find"])(
  "%s cannot silently install dependencies outside an offline worker",
  async (name) => {
    const { call } = await fixture();
    vi.stubEnv("PI_OFFLINE", "0");
    await expect(call(name, { pattern: "fixture" })).rejects.toThrow(
      "no tools were downloaded",
    );
  },
);
