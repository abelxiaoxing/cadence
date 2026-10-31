import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  RESEARCH_LIMITS,
  researchClock,
  researchTools,
} from "../src/research-tools.mjs";

async function fixture(now = researchClock) {
  const root = await mkdtemp(join(tmpdir(), "research-tools-"));
  const tools = researchTools(
    root,
    [root],
    { timeoutMs: 1200000, deadlineMs: now() + 1200000 },
    now,
  );
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
it("cooperative deadlines return labelled prefixes and reserve time for a final report", async () => {
  let clock = 0;
  const { root, call } = await fixture(() => clock);
  await writeFile(join(root, "a"), "evidence");
  clock = 1100000;
  await expect(call("ls", {})).rejects.toThrow("Summarize retained evidence");
  let ticks = 0;
  const tools = researchTools(
    root,
    [root],
    { timeoutMs: 1200000, deadlineMs: 1200000 },
    () => ticks++ * 15000,
  );
  const result = await tools.find((t) => t.name === "ls").execute("call", {});
  expect(result.content[0].text).toContain("cooperative time limit");
});
it("aborts do not start work and the cumulative call budget cannot be renewed by activity", async () => {
  const { call } = await fixture();
  const abort = new AbortController();
  abort.abort();
  await expect(call("ls", {}, abort.signal)).rejects.toThrow("canceled");
  for (let i = 1; i < RESEARCH_LIMITS.calls; i++) await call("ls", {});
  await expect(call("ls", {})).rejects.toThrow("budget reached");
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
  const tools = researchTools(root, [selected], {
    timeoutMs: 1200000,
    deadlineMs: researchClock() + 1200000,
  });
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
it("SDK bootstrap consumes the launcher's budget rather than restarting the report reserve", async () => {
  const { root } = await fixture();
  // Parent budget starts at 0; setup takes 3.5s before tools are constructed.
  let clock = 3500;
  const tools = researchTools(
    root,
    [root],
    { timeoutMs: 10000, deadlineMs: 10000 },
    () => clock,
  );
  const list = () => tools.find((t) => t.name === "ls").execute("id", {});
  clock = 8999;
  expect((await list()).content[0].text).toContain("Requested scope inspected");
  clock = 9000;
  await expect(list()).rejects.toThrow("Investigation budget reached");
  clock = 9500;
  await expect(list()).rejects.toThrow("Investigation budget reached");
  clock = 11000;
  const exhausted = researchTools(
    root,
    [root],
    { timeoutMs: 10000, deadlineMs: 10000 },
    () => clock,
  );
  await expect(exhausted[0].execute("id", {})).rejects.toThrow(
    "Investigation budget reached",
  );
});
