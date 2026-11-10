// @module-tag slow
// Messages sent into a running reply through a generated owner, its real SDK
// worker and Pi's own session file; only the provider is fabricated.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type {
  WorkbenchCommand,
  WorkbenchRead,
  WorkbenchResult,
} from "../src/service/contracts/workbench.ts";
import { BROWSER_COMMAND_ENTRY } from "../src/session-entries.mjs";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";

type Head = Extract<WorkbenchResult, { kind: "conversation" }>;

it("a steer is delivered inside the running reply as its own command, a queued message runs after it ends, and nothing is delivered after a withdrawal, an error or a Stop", async () => {
  const f = await acceptingFixture("generated");
  try {
    let client = f.client;
    expect((await client.session()).kind).toBe("ok");
    const catalog = await client.models();
    if (catalog.kind !== "ok") throw Error(JSON.stringify(catalog));
    const chosen = await client.chooseModel({
      expected: catalog.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (chosen.kind !== "ok") throw Error(JSON.stringify(chosen));
    const model = chosen.value.version;
    const read = async (request: WorkbenchRead) => {
      const reply = await client.workbenchRead(request);
      if (reply.kind !== "ok") throw Error(JSON.stringify(reply));
      return reply.value;
    };
    const head = async (id: string): Promise<Head> => {
      const view = await read({
        kind: "conversation",
        id,
        leaf: null,
        known: null,
      });
      if (view.kind !== "conversation") throw Error("conversation");
      return view;
    };
    /** Waits for an observation; the provider and the worker set the pace. */
    async function until<T>(
      what: string,
      observe: () => T | undefined | false | Promise<T | undefined | false>,
    ): Promise<T> {
      for (let attempt = 0; attempt < 750; attempt++) {
        const value = await observe();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw Error(`not observed: ${what}`);
    }
    const settled = (id: string) =>
      until("the reply settles", async () => {
        const view = await head(id);
        return view.summary && !view.summary.live ? view : undefined;
      });
    const command = async (request: WorkbenchCommand) =>
      client.workbenchCommand(request);
    /** A Send whose first model request the provider holds. */
    async function start(id: string, text: string) {
      const requests = f.contacts();
      const commandId = randomUUID();
      expect(
        await command({
          kind: "send",
          commandId,
          conversationId: id,
          head: null,
          text,
          model,
        }),
      ).toEqual({ kind: "ok", value: { kind: "accepted", commandId } });
      await until(
        "the first request",
        () => f.contacts() === requests + 1 && f.held() === 1,
      );
      const live = (await head(id)).summary?.live;
      if (live?.commandId !== commandId) throw Error("live");
      return { conversationId: id, turnId: commandId, epoch: live.epoch };
    }
    async function input(
      run: Awaited<ReturnType<typeof start>>,
      mode: "steer" | "queue",
      text: string,
    ) {
      const commandId = randomUUID();
      expect(
        await command({
          kind: "conversation-input",
          commandId,
          ...run,
          mode,
          text,
        }),
      ).toEqual({ kind: "ok", value: { kind: "accepted", commandId } });
      return commandId;
    }
    const withdraw = (
      run: Awaited<ReturnType<typeof start>>,
      inputId: string,
    ) =>
      command({
        kind: "conversation-input-cancel",
        commandId: randomUUID(),
        ...run,
        inputId,
      });
    const lastMessage = (request: number) => {
      const message = f.observations[request].messages.at(-1) as {
        role: string;
        content: unknown;
      };
      return { role: message.role, text: JSON.stringify(message.content) };
    };
    /** Pi's session file: its user messages, and which command marked each. */
    const written = (id: string) => {
      const sessions = join(f.dir, "agent", "sessions");
      const [dir] = readdirSync(sessions);
      const name = readdirSync(join(sessions, dir)).find((file) =>
        file.endsWith(`_${id}.jsonl`),
      );
      const lines = readFileSync(join(sessions, dir, name ?? ""), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      return lines
        .filter((l) => l.type === "message" && l.message.role === "user")
        .map((user) => ({
          text: user.message.content
            .map((p: { text: string }) => p.text)
            .join(""),
          boundaries: [
            ...new Set(
              lines
                .filter(
                  (l) =>
                    l.type === "custom" &&
                    l.customType === BROWSER_COMMAND_ENTRY &&
                    l.data.userId === user.id,
                )
                .map((l) => JSON.stringify(l.data)),
            ),
          ].map((data) => JSON.parse(data)),
          id: user.id as string,
        }));
    };

    // 1. A steer, a queued message and a withdrawn one in one reply.
    f.mode("pending");
    const id = randomUUID();
    const run = await start(id, "Start the work");
    const steer = await input(
      run,
      "steer",
      "Steer: look at existing.txt first",
    );
    const queued = await input(run, "queue", "Queued: then summarize");
    const dropped = await input(run, "queue", "Withdrawn: never send this");
    expect((await head(id)).pending).toEqual([
      {
        commandId: steer,
        mode: "steer",
        text: "Steer: look at existing.txt first",
      },
      { commandId: queued, mode: "queue", text: "Queued: then summarize" },
      { commandId: dropped, mode: "queue", text: "Withdrawn: never send this" },
    ]);
    // The worker still holds the queued one; Pi already has the steer.
    expect(await withdraw(run, dropped)).toMatchObject({
      kind: "ok",
      value: { kind: "accepted" },
    });
    expect(await withdraw(run, steer)).toEqual({
      kind: "error",
      error: { code: "conflict", effect: "none", recovery: "operator" },
    });
    expect((await head(id)).pending?.map((p) => p.commandId)).toEqual([
      steer,
      queued,
    ]);
    // Another conversation's reply cannot be steered through this one's turn.
    expect(
      await command({
        kind: "conversation-input",
        commandId: randomUUID(),
        ...run,
        conversationId: randomUUID(),
        mode: "steer",
        text: "Elsewhere",
      }),
    ).toMatchObject({
      kind: "error",
      error: { code: "stale", effect: "none" },
    });
    // The held request asks for a tool: the steer follows that tool's result
    // into the very next request, inside the same reply.
    f.releaseToolCall();
    await until("the request after the tool", () => f.contacts() === 2);
    expect(f.observations[1].messages.at(-2)).toMatchObject({ role: "tool" });
    expect(lastMessage(1)).toMatchObject({ role: "user" });
    expect(lastMessage(1).text).toContain("Steer: look at existing.txt first");
    const steered = await until("the steer's turn", async () => {
      const view = await head(id);
      return view.turns === 2 && view;
    });
    expect(steered.summary?.live).toMatchObject({ commandId: run.turnId });
    expect(steered.pending).toEqual([
      { commandId: queued, mode: "queue", text: "Queued: then summarize" },
    ]);
    // The reply ends normally: only then is the queued message sent.
    expect(f.held()).toBe(1);
    f.reply("Reply to the steer.");
    f.release();
    await until("the queued message's request", () => f.contacts() === 3);
    expect(lastMessage(2)).toMatchObject({ role: "user" });
    expect(lastMessage(2).text).toContain("Queued: then summarize");
    expect(JSON.stringify(f.observations[2].messages)).toContain(
      "Reply to the steer.",
    );
    expect(
      await until("the queued turn", async () => (await head(id)).turns === 3),
    ).toBe(true);
    f.reply("Reply to the queued message.");
    f.release();
    const done = await settled(id);
    expect(done).toMatchObject({
      summary: { status: "completed" },
      turns: 3,
      attempt: null,
      commands: [run.turnId, steer, queued, dropped],
    });
    expect(done).not.toHaveProperty("pending");
    expect(done).not.toHaveProperty("undelivered");
    // Three model requests in all; the withdrawn message reached none.
    expect(f.contacts()).toBe(3);
    expect(JSON.stringify(f.observations)).not.toContain("Withdrawn");
    const users = written(id);
    expect(users.map((user) => user.text)).toEqual([
      "Start the work",
      "Steer: look at existing.txt first",
      "Queued: then summarize",
    ]);
    // Each message is marked with its own command, and names the run it joined.
    expect(users.map((user) => user.boundaries)).toEqual([
      [{ commandId: run.turnId, userId: users[0].id }],
      [{ commandId: steer, userId: users[1].id, run: run.turnId }],
      [{ commandId: queued, userId: users[2].id, run: run.turnId }],
    ]);
    const turns = async () => {
      const view = await head(id);
      const out = [];
      for (let ordinal = 0; ordinal < view.turns; ordinal++) {
        const turn = await read({
          kind: "conversation-turn",
          id,
          leaf: view.leaf,
          ordinal,
          before: null,
        });
        if (turn.kind !== "conversation-turn") throw Error("turn");
        out.push({
          id: turn.turn.id,
          status: turn.turn.status,
          roles: turn.steps.map((step) => step.role),
          text: turn.steps.at(-1)?.text,
        });
      }
      return out;
    };
    const expected = [
      {
        id: users[0].id,
        status: "completed",
        roles: ["user", "tool"],
        text: "",
      },
      {
        id: users[1].id,
        status: "completed",
        roles: ["user", "assistant"],
        text: "Reply to the steer.",
      },
      {
        id: users[2].id,
        status: "completed",
        roles: ["user", "assistant"],
        text: "Reply to the queued message.",
      },
    ];
    expect(await turns()).toEqual(expected);

    // 2. A reply that fails delivers nothing further.
    const failing = randomUUID();
    const failed = await start(failing, "This one fails");
    const lost = [
      await input(failed, "steer", "Steer into a failure"),
      await input(failed, "queue", "Queued behind a failure"),
    ];
    f.fail();
    expect(await settled(failing)).toMatchObject({
      summary: { status: "failed" },
      turns: 1,
      undelivered: lost.map((commandId) => ({
        commandId,
        status: "canceled",
        notice: expect.stringContaining("Not delivered"),
      })),
    });
    expect(f.contacts()).toBe(4);
    expect(written(failing).map((user) => user.text)).toEqual([
      "This one fails",
    ]);

    // 3. Neither does a reply that is stopped.
    const stopping = randomUUID();
    const stopped = await start(stopping, "This one is stopped");
    const waiting = await input(stopped, "queue", "Queued behind a Stop");
    const steering = await input(stopped, "steer", "Steer into a Stop");
    expect(
      await command({
        kind: "interrupt",
        commandId: randomUUID(),
        ...stopped,
      }),
    ).toMatchObject({ kind: "ok" });
    const after = await settled(stopping);
    expect(after.summary?.status).toBe("canceled");
    expect(after.undelivered?.map((message) => message.commandId)).toEqual([
      waiting,
      steering,
    ]);
    // The reply has ended: nothing more is taken, and nothing ran meanwhile.
    expect(
      await command({
        kind: "conversation-input",
        commandId: randomUUID(),
        ...stopped,
        mode: "queue",
        text: "Too late",
      }),
    ).toMatchObject({
      kind: "error",
      error: { code: "stale", effect: "none" },
    });
    expect(f.contacts()).toBe(5);
    expect(JSON.stringify(f.observations)).not.toMatch(
      /Queued behind|Steer into/,
    );
    expect(written(stopping).map((user) => user.text)).toEqual([
      "This one is stopped",
    ]);

    // A cold owner reads the same turns and the same undelivered notices, and
    // replays none of them.
    client = (await f.restart()).client;
    expect(await turns()).toEqual(expected);
    expect((await head(failing)).undelivered?.map((m) => m.commandId)).toEqual(
      lost,
    );
    expect((await head(stopping)).undelivered).toHaveLength(2);
    expect(f.contacts()).toBe(5);
  } finally {
    await f.close();
  }
}, 120000);

it("a coordinator turn takes a message, and the plan it then publishes is approvable although the newest command is that message", async () => {
  const f = await acceptingFixture("generated");
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: f.root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("add", ".");
    git("commit", "-qm", "baseline");
    expect((await f.client.session()).kind).toBe("ok");
    const catalog = await f.client.models();
    if (catalog.kind !== "ok") throw Error("catalog");
    const chosen = await f.client.chooseModel({
      expected: catalog.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (chosen.kind !== "ok") throw Error(JSON.stringify(chosen));
    const read = async (request: WorkbenchRead) => {
      const reply = await f.client.workbenchRead(request);
      if (reply.kind !== "ok") throw Error(JSON.stringify(reply));
      return reply.value;
    };
    const id = randomUUID();
    const head = async (): Promise<Head> => {
      const view = await read({
        kind: "conversation",
        id,
        leaf: null,
        known: null,
      });
      if (view.kind !== "conversation") throw Error("conversation");
      return view;
    };
    const mode = async () => {
      const view = await read({ kind: "cadence-conversation", id });
      if (view.kind !== "cadence-conversation") throw Error("mode");
      return view.state;
    };
    async function until<T>(
      what: string,
      observe: () => Promise<T | undefined>,
    ): Promise<T> {
      for (let attempt = 0; attempt < 1500; attempt++) {
        const value = await observe();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw Error(`not observed: ${what}`);
    }
    f.mode("coordinator");
    const turnId = randomUUID();
    expect(
      await f.client.workbenchCommand({
        kind: "cadence-send",
        commandId: turnId,
        conversationId: id,
        head: null,
        text: "/cadence inspect the fixture",
        intent: "enter",
        revision: (await mode()).revision,
        model: chosen.value.version,
      }),
    ).toMatchObject({ kind: "ok" });
    // The coordinator investigates for a while: the user interjects.
    const live = await until("the coordinator turn", async () => {
      const view = await head();
      return view.summary?.live?.commandId === turnId
        ? view.summary.live
        : undefined;
    });
    const run = { conversationId: id, turnId, epoch: live.epoch };
    // An ordinary Send is refused in this mode, and so is steering a turn the
    // mode does not name.
    expect(
      await f.client.workbenchCommand({
        kind: "conversation-input",
        commandId: randomUUID(),
        ...run,
        turnId: randomUUID(),
        mode: "steer",
        text: "Elsewhere",
      }),
    ).toMatchObject({
      kind: "error",
      error: { code: "stale", effect: "none" },
    });
    const interjection = randomUUID();
    expect(
      await f.client.workbenchCommand({
        kind: "conversation-input",
        commandId: interjection,
        ...run,
        mode: "steer",
        text: "Decisions aligned, plan now",
      }),
    ).toEqual({
      kind: "ok",
      value: { kind: "accepted", commandId: interjection },
    });
    const done = await until("the turn settles", async () => {
      const view = await head();
      return view.summary && !view.summary.live ? view : undefined;
    });
    // One run: the investigation, then the interjection and the plan it asked
    // for, each its own turn; the mode still names the coordinator turn.
    expect(done).toMatchObject({
      summary: { status: "completed" },
      turns: 2,
      commands: [turnId, interjection],
    });
    expect(done).not.toHaveProperty("undelivered");
    const state = await mode();
    expect(state).toMatchObject({ enabled: true, head: turnId });
    expect(state.runs).toHaveLength(1);
    const proposal = state.proposal;
    if (!proposal) throw Error("no plan was published");
    expect(
      f.observations.some(
        (request) =>
          request.tools.includes("cadence_plan") &&
          JSON.stringify(request.messages.at(-1)).includes(
            "Decisions aligned, plan now",
          ),
      ),
    ).toBe(true);
    // Approval binds that run, all of it settled, and the branch's last turn.
    const prepare = (commandId = randomUUID()) =>
      f.client.workbenchCommand({
        kind: "cadence-prepare",
        commandId,
        conversationId: id,
        revision: state.revision,
        proposalId: proposal.id,
        digest: proposal.digest,
      });
    const granted = await prepare();
    expect(granted).toMatchObject({
      kind: "ok",
      value: { kind: "cadence-grant" },
    });
    if (granted.kind !== "ok" || granted.value.kind !== "cadence-grant")
      throw Error("grant");
    // A terminal message after it is a newer turn: the grant no longer binds,
    // and no fresh one is given for that branch end.
    const sessions = join(f.dir, "agent", "sessions");
    const [dir] = readdirSync(sessions);
    const name = readdirSync(join(sessions, dir)).find((file) =>
      file.endsWith(`_${id}.jsonl`),
    );
    appendFileSync(
      join(sessions, dir, name ?? ""),
      `${JSON.stringify({
        type: "message",
        id: "terminal1",
        parentId: done.leaf,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "text", text: "typed in the terminal" }],
        },
      })}\n`,
    );
    const contacts = f.contacts();
    expect(
      await f.client.workbenchCommand({
        kind: "cadence-approve",
        commandId: randomUUID(),
        conversationId: id,
        revision: state.revision,
        proposalId: proposal.id,
        digest: proposal.digest,
        grant: granted.value.grant,
      }),
    ).toMatchObject({ kind: "error", error: { effect: "none" } });
    expect(await prepare()).toMatchObject({
      kind: "error",
      error: { code: "stale", effect: "none" },
    });
    expect(f.contacts()).toBe(contacts);
    expect(existsSync(join(f.root, "a.txt"))).toBe(false);
  } finally {
    await f.close();
  }
}, 120000);
