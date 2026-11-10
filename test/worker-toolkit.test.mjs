import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createBashToolDefinition,
  createPowerShellToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkerToolkit } from "../src/worker-toolkit.mjs";
import {
  bindWorkerWorkspace,
  executionDirectory,
} from "../src/worker-workspace.mjs";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";

const resources = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map((toolkit) => toolkit.close()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function toolkit(purpose, cwd, extra = {}) {
  const kit = createWorkerToolkit({
    purpose,
    runtime: fixtureRuntime(),
    workspace: bindWorkerWorkspace(cwd),
    secrets: [],
    fail: vi.fn(),
    createLocalBashOperations: () => {
      throw new Error("No process fixture");
    },
    ...extra,
  });
  resources.push(kit);
  return kit;
}
it.each(["research", "diagnosis", "review"])(
  "%s gets the observation bundle, never shell/edit or role-supplied permissions",
  async (purpose) => {
    const root = await mkdtemp(join(tmpdir(), "toolkit-observe-"));
    await writeFile(join(root, "a"), "evidence");
    const kit = toolkit(purpose, root, { tools: ["bash", "write"] });
    expect(kit.instructions).toContain("Explicit absolute paths");
    expect(kit.instructions).toContain("no bash, write or edit");
    expect(kit.sessionOptions.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(kit.sessionOptions.cwd).toBe(root);
    expect(kit.sessionOptions.tools).toEqual(
      kit.sessionOptions.customTools.map((tool) => tool.name),
    );
    expect(kit.sessionOptions.tools).not.toContain("bash");
    expect(kit.sessionOptions.tools).not.toContain("edit");
    const tools = kit.wrap(kit.sessionOptions.customTools);
    const result = await tools
      .find((t) => t.name === "read")
      .execute("id", { path: "a" });
    expect(result.content[0].text).toContain("evidence");
    kit.sessionOptions.tools.push("bash"); // A changed SDK options array is not authority.
    expect(() => kit.wrap([{ name: "bash" }])).toThrow("Unexpected");
  },
);
it("coding capabilities preserve the standard SDK file tools and the no-spill bash adapter at the same cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "toolkit-code-"));
  let observed;
  const exec = vi.fn(async (_command, cwd, options) => {
    observed = { cwd, signal: options.signal };
    return { exitCode: 0 };
  });
  const lease = { grow() {}, release() {} };
  const kit = toolkit("edit", root, {
    createLocalBashOperations: () => ({ exec }),
    queue: { reserve: () => lease },
  });
  expect(kit.instructions).toBe("");
  expect(kit.sessionOptions.tools).toEqual([
    "read",
    "grep",
    "find",
    "ls",
    "write",
    "edit",
    "bash",
  ]);
  expect(kit.sessionOptions.customTools.map((t) => t.name)).toEqual(["bash"]);
  const result = await kit
    .wrap(kit.sessionOptions.customTools)[0]
    .execute("id", { command: "synthetic command" });
  expect(result.content[0].text).toBe("(no output)");
  expect(observed.cwd).toBe(kit.sessionOptions.cwd);
});
it("coordinators expose only their owner bridge and close listeners without gaining host tools", async () => {
  const events = new Map();
  vi.spyOn(process, "on").mockImplementation((event, fn) => {
    events.set(event, fn);
    return process;
  });
  const remove = vi
    .spyOn(process, "removeListener")
    .mockImplementation((event, fn) => {
      expect(events.get(event)).toBe(fn);
      events.delete(event);
      return process;
    });
  vi.stubGlobal("process", { ...process, send: vi.fn() });
  const kit = toolkit("research", resolve("."), { coordinator: true });
  expect(kit.sessionOptions.tools).toEqual([
    "cadence_research",
    "cadence_plan",
    "cadence_status",
  ]);
  expect(kit.sessionOptions.tools).not.toContain("read");
  await kit.close();
  expect(remove).toHaveBeenCalledTimes(2);
  expect(events.size).toBe(0);
  expect(() => toolkit("edit", resolve("."), { coordinator: true })).toThrow(
    "capability",
  );
});
it("close joins already executing stock tools, but refuses queued and later invocations", async () => {
  const kit = toolkit("edit", resolve("."));
  let release;
  const pending = new Promise((r) => {
    release = r;
  });
  const execute = vi.fn(() => pending);
  const [tool] = kit.wrap([{ name: "edit", execute }]);
  const first = tool.execute("id", {});
  await Promise.resolve();
  const queued = tool.execute("id2", {});
  const refused = expect(queued).rejects.toThrow("closed");
  let settled = false;
  const closing = kit.close();
  const observed = closing.then(() => {
    settled = true;
  });
  expect(kit.close()).toBe(closing);
  await refused;
  await expect(tool.execute("later", {})).rejects.toThrow("closed");
  expect(settled).toBe(false);
  release({ content: [] });
  await first;
  await observed;
  expect(execute).toHaveBeenCalledTimes(1);
});
it.each(["read", "find", "ls", "write", "edit"])(
  "%s cancellation never releases its original SDK operation early",
  async (name) => {
    const kit = toolkit("edit", resolve("."));
    let release;
    const pending = new Promise((done) => {
      release = done;
    });
    const execute = vi.fn((_id, _input, signal) => {
      expect(signal).toBeUndefined();
      return pending;
    });
    const [tool] = kit.wrap([{ name, execute }]);
    const abort = new AbortController();
    const running = tool.execute("id", {}, abort.signal);
    const rejected = expect(running).rejects.toThrow("may have completed");
    await Promise.resolve();
    abort.abort();
    let closed = false;
    const closing = kit.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release({ content: [] });
    await rejected;
    await closing;
    expect(execute).toHaveBeenCalledTimes(1);
  },
);
it("a pre-canceled call performs no operation; a tool error is not a cleanup failure", async () => {
  const kit = toolkit("edit", resolve("."));
  const execute = vi.fn(async () => {
    throw new Error("tool failed");
  });
  const [tool] = kit.wrap([{ name: "write", execute }]);
  const abort = new AbortController();
  abort.abort();
  await expect(tool.execute("id", {}, abort.signal)).rejects.toThrow(
    "canceled",
  );
  expect(execute).not.toHaveBeenCalled();
  await expect(tool.execute("id", {})).rejects.toThrow("tool failed");
  await expect(kit.close()).resolves.toBeUndefined();
});
it("the admitted workspace is immutable, nonactivating, and independent of process cwd", () => {
  const cwd = resolve("/not-created/checkout/subdir");
  const roots = ["../evidence"];
  const context = bindWorkerWorkspace(cwd, roots);
  roots[0] = "/";
  expect(context.cwd).toBe(cwd);
  expect(context.roots).toEqual([resolve(cwd, "../evidence")]);
  expect(Object.isFrozen(context)).toBe(true);
  expect(Object.isFrozen(context.roots)).toBe(true);
  expect(() => bindWorkerWorkspace("relative")).toThrow("directory");
  expect(() => bindWorkerWorkspace(cwd, [])).toThrow("roots");
});
it("existing execution context maps subdirectories into the owner-selected tree without creating it or changing the target", () => {
  const execution = {
    checkoutRoot: resolve("/origin"),
    cwd: resolve("/origin/app"),
    version: { epoch: "unchanged" },
  };
  const before = structuredClone(execution);
  expect(executionDirectory(execution, resolve("/candidate"))).toBe(
    resolve("/candidate/app"),
  );
  expect(executionDirectory(execution, resolve("/origin"))).toBe(execution.cwd);
  expect(execution).toEqual(before);
  expect(() =>
    executionDirectory(
      { ...execution, cwd: resolve("/outside") },
      resolve("/candidate"),
    ),
  ).toThrow("escaped");
});
it("only admitted editing workers get structured reporting; it grants no execution authority", async () => {
  const kit = toolkit("edit", resolve("."), {
    reporting: true,
    secrets: ["fixture-secret"],
  });
  const report = kit.sessionOptions.customTools.find(
    (t) => t.name === "cadence_report",
  );
  expect(report).toBeDefined();
  const result = await report.execute("report", {
    status: "blocked",
    summary: "Partial work; fixture-secret was withheld",
  });
  expect(JSON.parse(result.content[0].text)).toEqual({
    status: "blocked",
    summary: "Partial work; [redacted] was withheld",
  });
  // Proposed lessons are optional, bounded and sanitized like the summary.
  const taught = await report.execute("report", {
    status: "completed",
    summary: "Done",
    lessons: ["The fixture-secret header is read by auth.ts before routing"],
  });
  expect(JSON.parse(taught.content[0].text)).toEqual({
    status: "completed",
    summary: "Done",
    lessons: ["The [redacted] header is read by auth.ts before routing"],
  });
  expect(
    JSON.parse(
      (
        await report.execute("report", {
          status: "completed",
          summary: "Done",
          lessons: [],
        })
      ).content[0].text,
    ),
  ).toEqual({ status: "completed", summary: "Done" });
  for (const lessons of [
    "one",
    [1],
    [" "],
    ["a", "b", "c", "d", "e", "f"],
    ["x".repeat(401)],
  ])
    await expect(
      report.execute("report", {
        status: "completed",
        summary: "Done",
        lessons,
      }),
    ).rejects.toThrow("Invalid assignment report");
  await expect(
    report.execute("report", { status: "completed", summary: "" }),
  ).rejects.toThrow();
  await expect(
    report.execute("report", {
      status: "completed",
      summary: "done",
      command: "unapproved",
    }),
  ).rejects.toThrow();
  expect(
    toolkit("research", resolve("."), { reporting: true }).sessionOptions.tools,
  ).not.toContain("cadence_report");
  expect(toolkit("edit", resolve(".")).sessionOptions.tools).not.toContain(
    "cadence_report",
  );
});

it("a research worker can inspect an installed-package fixture outside its cwd without new execution rights", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "worker-project-"));
  const installed = await mkdtemp(join(tmpdir(), "worker-installed-pi-"));
  await writeFile(
    join(installed, "sdk.ts"),
    "export const npmCommand = 'npm';",
  );
  const kit = toolkit("research", cwd);
  const read = kit
    .wrap(kit.sessionOptions.customTools)
    .find((tool) => tool.name === "read");
  const result = await read.execute("lookup", {
    path: join(installed, "sdk.ts"),
  });
  expect(result.content[0].text).toContain("npmCommand");
  expect(kit.sessionOptions.cwd).toBe(cwd);
  for (const name of ["bash", "edit", "write", "cadence_report"])
    expect(kit.sessionOptions.tools).not.toContain(name);
});

it("editing inherits the configured Pi tool selection rather than a Cadence role list", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-tool-selection-"));
  const runtime = fixtureRuntime({ defaultTools: ["read", "edit", "find"] });
  const kit = toolkit("edit", root, { runtime });
  expect(kit.sessionOptions.tools).toEqual(runtime.tools.edit);
  expect(kit.sessionOptions.customTools).toEqual([]);
  expect(() => kit.wrap([{ name: "bash" }])).toThrow("Unexpected");
});
it.each(["bash", "powershell"])(
  "%s inherits Pi's definition and backend; settings remain pinned to its workspace",
  async (name) => {
    const root = await mkdtemp(join(tmpdir(), "pi-shell-selection-"));
    const runtime = fixtureRuntime({
      defaultTools: [name],
      shellPath: "/configured/bash",
      shellCommandPrefix: "export FIXTURE=1",
    });
    const exec = vi.fn(async () => ({ exitCode: 7 }));
    const bash = vi.fn(() => ({ exec })),
      powershell = vi.fn(() => ({ exec }));
    const kit = toolkit("edit", root, {
      runtime,
      createLocalBashOperations: bash,
      createLocalPowerShellOperations: powershell,
      queue: { reserve: () => ({ release() {} }) },
    });
    expect(kit.sessionOptions.tools).toEqual([name]);
    const definition = (
      name === "bash"
        ? createBashToolDefinition
        : createPowerShellToolDefinition
    )(root);
    const tool = kit.sessionOptions.customTools[0];
    expect(tool.parameters).toEqual(definition.parameters);
    expect(tool.constrainedSampling).toEqual(definition.constrainedSampling);
    expect(tool.promptSnippet).toBe(definition.promptSnippet);
    const result = await kit
      .wrap([tool])[0]
      .execute(
        "id",
        { command: "inspect", timeout: 12 },
        new AbortController().signal,
        undefined,
        { cwd: "/wrong-place" },
      );
    expect(exec).toHaveBeenCalledWith(
      name === "bash" ? "export FIXTURE=1\ninspect" : "inspect",
      root,
      expect.objectContaining({ timeout: 12 }),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent.exit_code).toBe(7);
    if (name === "bash")
      expect(bash).toHaveBeenCalledWith({ shellPath: "/configured/bash" });
    else expect(bash).not.toHaveBeenCalled();
  },
);
it("configured implementation tools never grant writes to independent readonly work", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-readonly-selection-"));
  const runtime = fixtureRuntime({ defaultTools: ["read", "bash", "write"] });
  const kit = toolkit("review", root, { runtime });
  expect(kit.sessionOptions.tools).toEqual(["read"]);
  expect(() =>
    toolkit("research", root, {
      runtime: { ...runtime, tools: { ...runtime.tools, readonly: ["bash"] } },
    }),
  ).toThrow("Readonly");
});
