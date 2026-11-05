import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RESEARCH_LIMITS, researchTools } from "../src/research-tools.mjs";

async function fixture(now = () => performance.now()) {
  const root = await mkdtemp(join(tmpdir(), "research-tools-"));
  const tools = researchTools(root, [root], now);
  const call = (name, args, signal) =>
    tools.find((t) => t.name === name).execute("call", args, signal);
  return { root, call };
}
it("scoped scans include backup trees, label truncation and reject parent escapes", async () => {
  const { root, call } = await fixture();
  await mkdir(join(root, "backup"));
  for (const name of ["a", "b", "c"])
    await writeFile(
      join(root, "backup", `${name}.txt`),
      `literal.* evidence ${name}\n`,
    );
  const found = await call("find", {
    path: "backup",
    pattern: "*.txt",
    limit: 2,
  });
  expect(found.content[0].text).toContain("Partial coverage: result limit");
  const grep = await call("grep", { path: "backup", pattern: "literal.*" });
  expect(grep.content[0].text).toContain("a.txt:1: literal.* evidence a");
  expect(grep.content[0].text).toContain("c.txt:1:");
  await expect(call("ls", { path: ".." })).rejects.toThrow(
    "outside investigation roots",
  );
  const shallow = await call("find", { pattern: "*.txt", depth: 0 });
  expect(shallow.content[0].text).toContain(
    "No results in the inspected portion",
  );
  expect(shallow.content[0].text).toContain("depth limit");
  await expect(
    call("grep", { pattern: "a.*", literal: false }),
  ).rejects.toThrow("literal");
});
it("text reads and searches have byte ceilings and binary omission is not an empty complete result", async () => {
  const { root, call } = await fixture();
  await writeFile(
    join(root, "large.txt"),
    "x".repeat(RESEARCH_LIMITS.fileBytes + 1),
  );
  const read = await call("read", { path: "large.txt" });
  expect(read.content[0].text).toContain("file/aggregate byte limit");
  expect(read.content[0].text.length).toBeLessThan(RESEARCH_LIMITS.outputBytes);
  await writeFile(join(root, "binary"), Buffer.from([0, 1, 2]));
  expect((await call("read", { path: "binary" })).content[0].text).toContain(
    "binary file omitted",
  );
  await expect(call("read", { path: "." })).rejects.toThrow();
});
it("cooperative per-call deadlines return labelled prefixes", async () => {
  const { root } = await fixture();
  let ticks = 0;
  const tools = researchTools(root, [root], () => ticks++ * 15000);
  const result = await tools.find((t) => t.name === "ls").execute("call", {});
  expect(result.content[0].text).toContain("cooperative time limit");
});
it("cancellation still refuses work but calls have no cumulative quota", async () => {
  const { root, call } = await fixture();
  await writeFile(join(root, "a"), "evidence");
  const abort = new AbortController();
  abort.abort();
  await expect(call("read", { path: "a" }, abort.signal)).rejects.toThrow(
    "canceled",
  );
  for (let i = 0; i < 80; i++)
    expect((await call("read", { path: "a" })).content[0].text).toContain(
      "evidence",
    );
});
it.skipIf(process.platform === "win32")(
  "symlinks do not expand the scan scope",
  async () => {
    const { root, call } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "research-outside-"));
    await writeFile(join(outside, "private.txt"), "not selected");
    await symlink(outside, join(root, "link"));
    const result = await call("find", { pattern: "*.txt" });
    expect(result.content[0].text).not.toContain("private.txt");
    expect(result.content[0].text).toContain("symlink omitted");
    await expect(call("read", { path: "link/private.txt" })).rejects.toThrow(
      "outside investigation roots",
    );
  },
);
it("relative paths resolve against the explicit investigation root, not an unrelated checkout", async () => {
  const { root } = await fixture();
  const selected = await mkdtemp(join(tmpdir(), "selected-root-"));
  await writeFile(join(selected, "save.txt"), "selected evidence");
  const tools = researchTools(root, [selected]);
  const read = await tools
    .find((t) => t.name === "read")
    .execute("call", { path: "save.txt" });
  expect(read.content[0].text).toContain("selected evidence");
  await expect(
    tools
      .find((t) => t.name === "find")
      .execute("call", { pattern: "{1..100000000}" }),
  ).rejects.toThrow("simple glob");
});
it("elapsed worker time never introduces an early tool-admission cutoff", async () => {
  let clock = 0;
  const { call } = await fixture(() => clock);
  for (const elapsed of [0, 1080000, 1200000, 2400000]) {
    clock = elapsed;
    expect((await call("ls", {})).content[0].text).toContain(
      "Requested scope inspected",
    );
  }
});
