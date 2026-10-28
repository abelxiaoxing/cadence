import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { serviceStatus, stopService } from "../src/service/cli.ts";
import type { WorkbenchResult } from "../src/service/contracts/workbench.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import type { Reply } from "../src/service-contract.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";

function ok<T>(reply: Reply<T>): T {
  expect(reply.kind, JSON.stringify(reply)).toBe("ok");
  if (reply.kind !== "ok") throw Error("refused");
  return reply.value;
}
it("generated owner supports real multi-turn ordinary chat, readonly files, idempotency and retained restart without task creation", async () => {
  const f = await acceptingFixture("generated");
  let client = f.client;
  try {
    ok(await client.session());
    const catalog = ok(await client.models());
    const selected = ok(
      await client.chooseModel({
        expected: catalog.version,
        choice: {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    );
    expect(f.contacts()).toBe(0);
    expect(ok(await client.workbenchRead({ kind: "conversations" }))).toEqual({
      kind: "conversations",
      entries: [],
    });
    const tasks = readdirSync(join(f.root, ".cadence/assistant/tasks"));
    const orphan = randomUUID(),
      orphanDirectory = join(f.c.directory, "conversations-v1/turns", orphan);
    mkdirSync(orphanDirectory, { recursive: true, mode: 0o700 });
    const sentinel = join(orphanDirectory, "context.json");
    writeFileSync(sentinel, "uncertain context preserved", { mode: 0o600 });
    expect(
      await client.workbenchCommand({
        kind: "send",
        commandId: orphan,
        conversationId: randomUUID(),
        head: null,
        text: "Do not adopt",
        model: selected.version,
      }),
    ).toMatchObject({ kind: "error", error: { code: "corrupt-selected" } });
    expect(readFileSync(sentinel, "utf8")).toBe("uncertain context preserved");
    expect(f.contacts()).toBe(0);
    const id = randomUUID();
    const command = {
      kind: "send" as const,
      commandId: randomUUID(),
      conversationId: id,
      head: null,
      text: "Hello, ordinary conversation",
      model: selected.version,
    };
    expect(ok(await client.workbenchCommand(command))).toEqual({
      kind: "accepted",
      commandId: command.commandId,
    });
    const view = async () =>
      ok(
        await client.workbenchRead({ kind: "conversation", id, before: null }),
      ) as Extract<WorkbenchResult, { kind: "conversation" }>;
    await expect
      .poll(async () => (await view()).summary?.status, {
        timeout: 15000,
        interval: 100,
      })
      .toBe("completed");
    expect(
      (await view()).turns
        .flatMap((turn) => turn.items)
        .some(
          (item) =>
            item.role === "assistant" && item.text.includes("Advisory:"),
        ),
    ).toBe(true);
    expect(ok(await client.workbenchCommand(command)).kind).toBe("accepted");
    expect(f.contacts()).toBe(1);
    expect(
      await client.workbenchCommand({ ...command, text: "different" }),
    ).toMatchObject({ kind: "error", error: { code: "conflict" } });
    const next = {
      ...command,
      commandId: randomUUID(),
      head: command.commandId,
      text: "Remember my previous message",
    };
    ok(await client.workbenchCommand(next));
    await expect
      .poll(async () => (await view()).summary?.status, {
        timeout: 15000,
        interval: 100,
      })
      .toBe("completed");
    expect(f.contacts()).toBe(2);
    const checkpoint = JSON.parse(
      readFileSync(
        join(
          f.c.directory,
          "conversations-v1/turns",
          next.commandId,
          "context.json",
        ),
        "utf8",
      ),
    );
    expect(
      checkpoint.messages.filter(
        (message: { role: string }) => message.role === "user",
      ),
    ).toHaveLength(2);
    expect(JSON.stringify(checkpoint)).not.toContain(
      "fabricated-accepting-key",
    );
    expect(
      f.observations.every(
        (entry) =>
          entry.tools.includes("write") && entry.tools.includes("bash"),
      ),
    ).toBe(true);
    expect(readdirSync(join(f.root, ".cadence/assistant/tasks"))).toEqual(
      tasks,
    );
    writeFileSync(
      join(f.root, "ordinary.txt"),
      "preview fabricated-accepting-key",
    );
    expect(
      ok(await client.workbenchRead({ kind: "file", path: "ordinary.txt" })),
    ).toMatchObject({ kind: "file", limited: false });
    expect(
      JSON.stringify(
        ok(await client.workbenchRead({ kind: "file", path: "ordinary.txt" })),
      ),
    ).not.toContain("fabricated-accepting-key");
    for (const path of ["../agent/auth.json", ".env", "/etc/passwd"])
      expect(await client.workbenchRead({ kind: "file", path })).toMatchObject({
        kind: "error",
      });
    if (process.platform !== "win32") {
      symlinkSync(join(f.dir, "agent/auth.json"), join(f.root, "linked.txt"));
      expect(
        await client.workbenchRead({ kind: "file", path: "linked.txt" }),
      ).toMatchObject({ kind: "error" });
    }
    ({ client } = await f.restart());
    ok(await client.session());
    expect(ok(await client.models()).selected).toBeNull();
    expect((await view()).turns).toHaveLength(2);
    expect(f.contacts()).toBe(2);
    expect(existsSync(join(f.root, "ordinary.txt"))).toBe(true);
  } finally {
    await f.close();
  }
}, 45000);

it("queued chats share the checkout gate, browser departure does not cancel, and explicit interrupt observes native closure", async () => {
  const f = await acceptingFixture("generated");
  let client = f.client;
  try {
    ok(await client.session());
    const catalog = ok(await client.models());
    const selected = ok(
      await client.chooseModel({
        expected: catalog.version,
        choice: {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    );
    f.mode("pending");
    const first = {
      kind: "send" as const,
      commandId: randomUUID(),
      conversationId: randomUUID(),
      head: null,
      text: "Wait for interruption",
      model: selected.version,
    };
    ok(await client.workbenchCommand(first));
    await expect
      .poll(() => f.contacts(), { timeout: 15000, interval: 100 })
      .toBe(1);
    const second = {
      ...first,
      commandId: randomUUID(),
      conversationId: randomUUID(),
      text: "Queued",
    };
    ok(await client.workbenchCommand(second));
    expect(
      ok(
        await client.workbenchRead({
          kind: "conversation",
          id: second.conversationId,
          before: null,
        }),
      ),
    ).toMatchObject({ summary: { status: "queued" } });
    await f.transport.detach();
    expect(f.contacts()).toBe(1);
    ok(await client.session());
    expect(
      ok(await client.workbenchRead({ kind: "conversations" })),
    ).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          id: first.conversationId,
          status: "running",
        }),
      ]),
    });
    const removedMetadata = join(
      f.c.directory,
      "conversations-v1/sessions",
      `${first.conversationId}.json`,
    );
    unlinkSync(removedMetadata); // Isolated negative fixture only; never a recovery path.
    expect(
      ok(
        await client.workbenchRead({
          kind: "conversation",
          id: first.conversationId,
          before: null,
        }),
      ),
    ).toMatchObject({
      summary: { status: "running" },
      turns: [
        expect.objectContaining({
          notice: expect.stringContaining("No state was reconstructed"),
        }),
      ],
    });
    expect(existsSync(removedMetadata)).toBe(false);
    for (const command of [second, first])
      ok(
        await client.workbenchCommand({
          kind: "interrupt",
          commandId: randomUUID(),
          conversationId: command.conversationId,
          turnId: command.commandId,
          epoch: selected.version.epoch,
        }),
      );
    await expect
      .poll(
        async () => {
          const view = ok(
            await client.workbenchRead({ kind: "conversations" }),
          );
          return (
            view.kind === "conversations" &&
            view.entries.every((entry) => entry.status === "canceled")
          );
        },
        { timeout: 15000, interval: 100 },
      )
      .toBe(true);
    expect(f.contacts()).toBe(1);
    expect(f.maxActive()).toBe(1);
    expect(
      JSON.parse(
        readFileSync(
          join(
            f.c.directory,
            "conversations-v1/turns",
            first.commandId,
            "turn.json",
          ),
          "utf8",
        ),
      ).status,
    ).toBe("canceled");
    expect(existsSync(removedMetadata)).toBe(false);
    expect(
      await client.workbenchCommand({ ...first, commandId: randomUUID() }),
    ).toMatchObject({ kind: "error", error: { code: "corrupt-selected" } });
    const stopped = {
      ...first,
      commandId: randomUUID(),
      conversationId: randomUUID(),
      text: "Orderly owner Stop",
    };
    ok(await client.workbenchCommand(stopped));
    await expect
      .poll(() => f.contacts(), { timeout: 15000, interval: 100 })
      .toBe(2);
    ({ client } = await f.restart());
    expect(
      ok(
        await client.workbenchRead({
          kind: "conversation",
          id: stopped.conversationId,
          before: null,
        }),
      ),
    ).toMatchObject({ summary: { status: "canceled" } });
    expect(f.contacts()).toBe(2);
  } finally {
    await f.close();
  }
}, 30000);

it("ordinary tools edit the host without a Cadence task and preserve actual tool context", async () => {
  const f = await acceptingFixture("generated");
  try {
    writeFileSync(
      join(f.root, "AGENTS.md"),
      "Project instruction: ordinary-project-marker.\n",
    );
    ok(await f.client.session());
    const catalog = ok(await f.client.models());
    const selected = ok(
      await f.client.chooseModel({
        expected: catalog.version,
        choice: {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    );
    const command = {
      kind: "send" as const,
      commandId: randomUUID(),
      conversationId: randomUUID(),
      head: null,
      text: "Write a small file",
      model: selected.version,
    };
    f.mode("write");
    ok(await f.client.workbenchCommand(command));
    let view: WorkbenchResult;
    await expect
      .poll(
        async () => {
          view = ok(
            await f.client.workbenchRead({
              kind: "conversation",
              id: command.conversationId,
              before: null,
            }),
          );
          return view.kind === "conversation" ? view.summary?.status : null;
        },
        { timeout: 15000, interval: 100 },
      )
      .toBe("completed");
    expect(readFileSync(join(f.root, "ordinary-created.txt"), "utf8")).toBe(
      "ordinary tool output\n",
    );
    expect(f.contacts()).toBe(2);
    expect(JSON.stringify(f.observations[0].messages)).toContain(
      "ordinary-project-marker",
    );
    expect(f.observations[0].tools).not.toContain("subagent");
    expect(f.observations[0].tools).not.toContain("delegate_task");
    const checkpoint = JSON.parse(
      readFileSync(
        join(
          f.c.directory,
          "conversations-v1/turns",
          command.commandId,
          "context.json",
        ),
        "utf8",
      ),
    );
    expect(
      checkpoint.messages.some(
        (message: { role: string }) => message.role === "toolResult",
      ),
    ).toBe(true);
    expect(JSON.stringify(view!)).toContain('"name":"write"');
    const link = {
      kind: "link-task" as const,
      commandId: randomUUID(),
      epoch: selected.version.epoch,
      taskId: f.legacyId,
      conversationId: command.conversationId,
    };
    ok(await f.client.workbenchCommand(link));
    expect(
      ok(
        await f.client.workbenchRead({
          kind: "task-origin",
          taskId: f.legacyId,
        }),
      ),
    ).toEqual({
      kind: "task-origin",
      taskId: f.legacyId,
      conversationId: command.conversationId,
    });
    expect(readdirSync(join(f.root, ".cadence/assistant/tasks"))).toEqual([
      f.legacyId,
    ]);
  } finally {
    await f.close();
  }
}, 30000);

it("directory browsing is passive and explicit project opening preserves independent owners and ports without task creation", async () => {
  const f = await acceptingFixture("generated");
  const path = join(f.dir, "second-project");
  mkdirSync(path, { mode: 0o700 });
  const other = new ServiceCoordination(path, f.c.stateHome);
  let opened = false;
  try {
    const session = ok(await f.client.session());
    expect(
      ok(await f.client.workbenchRead({ kind: "directories", path })),
    ).toMatchObject({ kind: "directories", path });
    expect(other.inspect()).toEqual({ status: "absent" });
    const command = {
      kind: "open-project" as const,
      commandId: randomUUID(),
      epoch: session.epoch,
      path,
    };
    const result = ok(await f.client.workbenchCommand(command));
    opened = true;
    expect(result).toMatchObject({ kind: "project", path });
    if (result.kind !== "project") throw Error("Missing project result");
    const endpoint = new URL(result.link).origin;
    expect(endpoint).not.toBe(f.endpoint);
    expect(new URL(result.link).searchParams.has("token")).toBe(true);
    expect(await serviceStatus(other)).toMatchObject({
      status: "alive",
      actions: false,
    });
    expect(ok(await f.client.workbenchCommand(command))).toEqual(result);
    const again = ok(
      await f.client.workbenchCommand({ ...command, commandId: randomUUID() }),
    );
    expect(again).toMatchObject({ kind: "project", path, link: result.link });
    expect(other.localAccess().endpoint).toBe(endpoint);
    expect(f.c.localAccess().endpoint).toBe(f.endpoint);
    expect(ok(await f.client.workbenchRead({ kind: "projects" }))).toEqual({
      kind: "projects",
      entries: [
        { path: f.root, current: true },
        { path, current: false },
      ],
    });
    expect(f.contacts()).toBe(0);
    expect(existsSync(join(path, ".cadence/assistant/tasks"))).toBe(false);
  } finally {
    if (opened)
      expect(await stopService(other)).toMatchObject({ status: "stopped" });
    await f.close();
  }
}, 30000);

it("access rotation revokes viewers without canceling an admitted queued ordinary turn", async () => {
  const f = await acceptingFixture("generated");
  try {
    ok(await f.client.session());
    const catalog = ok(await f.client.models());
    const selected = ok(
      await f.client.chooseModel({
        expected: catalog.version,
        choice: {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    );
    f.mode("pending");
    const first = {
      kind: "send" as const,
      commandId: randomUUID(),
      conversationId: randomUUID(),
      head: null,
      text: "First turn",
      model: selected.version,
    };
    const second = {
      ...first,
      commandId: randomUUID(),
      conversationId: randomUUID(),
      text: "Admitted before rotation",
    };
    ok(await f.client.workbenchCommand(first));
    await expect
      .poll(() => f.contacts(), { timeout: 15000, interval: 100 })
      .toBe(1);
    ok(await f.client.workbenchCommand(second));
    await f.rotate();
    ok(await f.client.session());
    ok(
      await f.client.workbenchCommand({
        kind: "interrupt",
        commandId: randomUUID(),
        conversationId: first.conversationId,
        turnId: first.commandId,
        epoch: selected.version.epoch,
      }),
    );
    await expect
      .poll(() => f.contacts(), { timeout: 15000, interval: 100 })
      .toBe(2);
    expect(
      ok(
        await f.client.workbenchRead({
          kind: "conversation",
          id: second.conversationId,
          before: null,
        }),
      ),
    ).toMatchObject({ summary: { status: "running" } });
    ok(
      await f.client.workbenchCommand({
        kind: "interrupt",
        commandId: randomUUID(),
        conversationId: second.conversationId,
        turnId: second.commandId,
        epoch: selected.version.epoch,
      }),
    );
    await expect
      .poll(
        async () => {
          const view = ok(
            await f.client.workbenchRead({
              kind: "conversation",
              id: second.conversationId,
              before: null,
            }),
          );
          return view.kind === "conversation" ? view.summary?.status : null;
        },
        { timeout: 15000, interval: 100 },
      )
      .toBe("canceled");
  } finally {
    await f.close();
  }
}, 30000);
