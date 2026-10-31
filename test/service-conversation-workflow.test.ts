import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type {
  WorkbenchCommand,
  WorkbenchRead,
} from "../src/service/contracts/workbench.ts";
import { ServiceClient } from "../src/service-client.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { nativeBuild } from "./helpers/source-build.ts";

it("persistent SDK coordinator investigates, clarifies, proposes without editing; one exact approval integrates and exit does not inherit authority", async () => {
  const f = await acceptingFixture("generated");
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: f.root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("add", ".");
    git("commit", "-qm", "baseline");
    const b = await f.client.session();
    if (b.kind !== "ok") throw Error("bootstrap");
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
    const read = async (r: WorkbenchRead) => {
      const v = await f.client.workbenchRead(r);
      if (v.kind !== "ok") throw Error(JSON.stringify(v));
      return v.value;
    };
    const command = async (c: WorkbenchCommand) => {
      const r = await f.client.workbenchCommand(c);
      if (r.kind !== "ok") throw Error(JSON.stringify(r));
      return r.value;
    };
    const id = randomUUID();
    let head: string | null = null;
    const state = async () => {
      const v = await read({ kind: "cadence-conversation", id });
      if (v.kind !== "cadence-conversation") throw Error("state");
      return v.state;
    };
    async function send(
      text: string,
      intent: "enter" | "message" | "exit" = "message",
    ) {
      const commandId = randomUUID(),
        s = await state();
      await command({
        kind: "cadence-send",
        commandId,
        conversationId: id,
        head,
        text,
        intent,
        revision: s.revision,
        model:
          chosen.kind === "ok"
            ? chosen.value.version
            : catalog.kind === "ok"
              ? catalog.value.version
              : never(),
      });
      head = commandId;
      let view = await read({ kind: "conversation", id, before: null });
      for (let i = 0; i < 750; i++) {
        view = await read({ kind: "conversation", id, before: null });
        if (
          view.kind === "conversation" &&
          !["queued", "running"].includes(view.summary?.status ?? "queued")
        )
          break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(
        view.kind === "conversation" && view.summary?.status,
        JSON.stringify(view),
      ).toBe("completed");
      return state();
    }
    f.mode("coordinator");
    await send("/cadence inspect the fixture", "enter");
    expect((await state()).enabled).toBe(true);
    const investigated = await state();
    expect(investigated.runs).toHaveLength(1);
    const investigation = await read({
      kind: "workflow",
      id: investigated.runs[0],
    });
    if (
      investigation.kind !== "workflow" ||
      investigation.response.type !== "run"
    )
      throw Error("investigation");
    const step = investigation.response.run.steps[0];
    expect(step.childRunId).toBeTruthy();
    const transcript = await read({
      kind: "workflow-transcript",
      id: investigated.runs[0],
      stepId: step.id,
    });
    expect(
      transcript.kind === "workflow-transcript" &&
        transcript.turn?.items.some((item) => item.name === "read"),
    ).toBe(true);
    expect(JSON.stringify(transcript)).not.toContain(
      "fabricated-accepting-key",
    );
    const outside = await f.client.workbenchRead({
      kind: "workflow-transcript",
      id: investigated.runs[0],
      stepId: "not-an-observed-step",
    });
    expect(outside.kind).toBe("error");
    expect(existsSync(join(f.root, "a.txt"))).toBe(false);
    const s = await send("Decisions aligned, plan now");
    expect(s.proposal).not.toBeNull();
    const blocked = await f.client.workbenchCommand({
      kind: "send",
      commandId: randomUUID(),
      conversationId: id,
      head,
      text: "write without plan",
      model: chosen.value.version,
    });
    expect(blocked.kind).toBe("error");
    expect(existsSync(join(f.root, "a.txt"))).toBe(false);
    const p = s.proposal!;
    const grant = await command({
      kind: "cadence-prepare",
      commandId: randomUUID(),
      conversationId: id,
      revision: s.revision,
      proposalId: p.id,
      digest: p.digest,
    });
    if (grant.kind !== "cadence-grant") throw Error("grant");
    const approval = {
      kind: "cadence-approve" as const,
      commandId: randomUUID(),
      conversationId: id,
      revision: s.revision,
      proposalId: p.id,
      digest: p.digest,
      grant: grant.grant,
    };
    const accepted = await command(approval);
    expect(accepted.kind).toBe("workflow");
    const again = await f.client.workbenchCommand({
      ...approval,
      commandId: randomUUID(),
    });
    expect(again.kind).toBe("error");
    // Control-plane conversation must not wait on the execution checkout barrier.
    await send("status please");
    let run = await read({ kind: "workflow", id: approval.commandId });
    for (let i = 0; i < 1000; i++) {
      run = await read({ kind: "workflow", id: approval.commandId });
      if (
        run.kind === "workflow" &&
        run.response.type === "run" &&
        !["queued", "running"].includes(run.response.run.status)
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(
      run.kind === "workflow" &&
        run.response.type === "run" &&
        run.response.run.status,
      JSON.stringify(run),
    ).toBe("completed");
    expect(readFileSync(join(f.root, "a.txt"), "utf8")).toContain(
      "implemented",
    );
    expect((await state()).enabled).toBe(true);
    expect(
      f.observations
        .filter((o) => o.tools.includes("cadence_plan"))
        .every(
          (o) =>
            !o.tools.some((t) => ["write", "edit", "bash", "read"].includes(t)),
        ),
    ).toBe(true);
    await send("exit cadence", "exit");
    expect((await state()).enabled).toBe(false);
  } finally {
    await f.close();
  }
}, 60000);
function never(): never {
  throw Error("model");
}

it("mode survives owner restart without replay or model restoration on reads; explicit restore uses a fresh source identity and exit needs no model", async () => {
  const f = await acceptingFixture("generated");
  try {
    let client = f.client;
    const boot = await client.session();
    if (boot.kind !== "ok") throw Error("session");
    const models = await client.models();
    if (models.kind !== "ok") throw Error("models");
    const selected = await client.chooseModel({
      expected: models.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (selected.kind !== "ok") throw Error("selection");
    f.mode("coordinator");
    const id = randomUUID(),
      commandId = randomUUID();
    const accepted = await client.workbenchCommand({
      kind: "cadence-send",
      commandId,
      conversationId: id,
      head: null,
      text: "/cadence",
      model: selected.value.version,
      revision: 0,
      intent: "enter",
    });
    expect(accepted.kind).toBe("ok");
    await settleTurn(client, id);
    const contacts = f.contacts();
    const restarted = await f.restart();
    client = restarted.client;
    const state = await client.workbenchRead({
      kind: "cadence-conversation",
      id,
    });
    expect(
      state.kind === "ok" &&
        state.value.kind === "cadence-conversation" &&
        state.value.state.enabled,
    ).toBe(true);
    const empty = await client.models();
    expect(empty.kind === "ok" && empty.value.selected).toBeNull();
    expect(f.contacts()).toBe(contacts);
    const restored = await client.workbenchCommand({
      kind: "restore-model",
      commandId: randomUUID(),
      epoch: restarted.epoch,
    });
    expect(restored.kind).toBe("ok");
    const current = await client.models();
    if (current.kind !== "ok") throw Error("restored model");
    expect(current.value.selected?.sourceSelectionId).not.toBe(
      selected.value.selected?.sourceSelectionId,
    );
    const prefs = readFileSync(
      join(f.dir, "agent", "cadence", "settings.json"),
      "utf8",
    );
    expect(prefs).not.toContain("sourceSelectionId");
    expect(prefs).not.toContain("fabricated-accepting-key");
    const restartedAgain = await f.restart();
    client = restartedAgain.client;
    const catalog = await client.models();
    if (catalog.kind !== "ok") throw Error("models");
    const mode = await client.workbenchRead({
      kind: "cadence-conversation",
      id,
    });
    if (mode.kind !== "ok" || mode.value.kind !== "cadence-conversation")
      throw Error("mode");
    const exit = await client.workbenchCommand({
      kind: "cadence-send",
      commandId: randomUUID(),
      conversationId: id,
      head: commandId,
      text: "exit cadence",
      model: catalog.value.version,
      revision: mode.value.state.revision,
      intent: "exit",
    });
    expect(exit.kind).toBe("ok");
    await settleTurn(client, id);
    const exited = await client.workbenchRead({
      kind: "cadence-conversation",
      id,
    });
    expect(
      exited.kind === "ok" &&
        exited.value.kind === "cadence-conversation" &&
        exited.value.state.enabled,
    ).toBe(false);
    expect(f.contacts()).toBe(contacts);
  } finally {
    await f.close();
  }
}, 60000);
async function settleTurn(
  client: typeof import("../src/service-client.ts").ServiceClient.prototype,
  id: string,
) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const v = await client.workbenchRead({
      kind: "conversation",
      id,
      before: null,
    });
    if (
      v.kind === "ok" &&
      v.value.kind === "conversation" &&
      v.value.summary &&
      !["queued", "running"].includes(v.value.summary.status)
    ) {
      expect(v.value.summary.status, JSON.stringify(v)).toBe("completed");
      return v.value;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("turn did not settle");
}

it("grants bind the actual attachment; competing approvals admit once, exit detaches and explicit cancel joins original workers", async () => {
  const f = await acceptingFixture("generated");
  let other: HttpServiceTransport | undefined;
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: f.root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("add", ".");
    git("commit", "-qm", "baseline");
    const boot = await f.client.session();
    if (boot.kind !== "ok") throw Error("session");
    const models = await f.client.models();
    if (models.kind !== "ok") throw Error("models");
    const selected = await f.client.chooseModel({
      expected: models.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (selected.kind !== "ok") throw Error("selection");
    f.mode("coordinator");
    const id = randomUUID(),
      head = randomUUID();
    const sent = await f.client.workbenchCommand({
      kind: "cadence-send",
      commandId: head,
      conversationId: id,
      head: null,
      text: "/cadence Decisions aligned, plan now",
      model: selected.value.version,
      revision: 0,
      intent: "enter",
    });
    expect(sent.kind).toBe("ok");
    await settleTurn(f.client, id);
    const state = await f.client.workbenchRead({
      kind: "cadence-conversation",
      id,
    });
    if (
      state.kind !== "ok" ||
      state.value.kind !== "cadence-conversation" ||
      !state.value.state.proposal
    )
      throw Error("proposal");
    const s = state.value.state,
      p = s.proposal!;
    const base = {
      conversationId: id,
      revision: s.revision,
      proposalId: p.id,
      digest: p.digest,
    };
    const prepare = async () => {
      const r = await f.client.workbenchCommand({
        kind: "cadence-prepare",
        commandId: randomUUID(),
        ...base,
      });
      if (r.kind !== "ok" || r.value.kind !== "cadence-grant")
        throw Error(JSON.stringify(r));
      return r.value.grant;
    };
    const grant = await prepare(),
      local = f.c.localAccess();
    other = new HttpServiceTransport({
      origin: local.endpoint,
      localCapability: local.capability,
      build: nativeBuild,
    });
    const otherClient = new ServiceClient(other);
    expect((await otherClient.session()).kind).toBe("ok");
    const stolen = await otherClient.workbenchCommand({
      kind: "cadence-approve",
      commandId: randomUUID(),
      ...base,
      grant,
    });
    expect(stolen.kind === "error" && stolen.error.code).toBe("expired-grant");
    expect(existsSync(join(f.root, "a.txt"))).toBe(false);
    const fresh = await prepare();
    f.mode("pending");
    const replies = await Promise.all(
      [1, 2].map(() =>
        f.client.workbenchCommand({
          kind: "cadence-approve",
          commandId: randomUUID(),
          ...base,
          grant: fresh,
        }),
      ),
    );
    expect(replies.filter((r) => r.kind === "ok")).toHaveLength(1);
    const accepted = replies.find((r) => r.kind === "ok");
    if (
      accepted?.kind !== "ok" ||
      accepted.value.kind !== "workflow" ||
      !accepted.value.commandId
    )
      throw Error("run");
    const runId = accepted.value.commandId;
    const deadline = Date.now() + 15000;
    while (!f.held() && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    expect(f.held()).toBeGreaterThan(0);
    const mode = await f.client.workbenchRead({
      kind: "cadence-conversation",
      id,
    });
    if (mode.kind !== "ok" || mode.value.kind !== "cadence-conversation")
      throw Error("state");
    expect(mode.value.state.runs).toEqual([runId]);
    const exit = await f.client.workbenchCommand({
      kind: "cadence-exit",
      commandId: randomUUID(),
      conversationId: id,
      head,
      revision: mode.value.state.revision,
    });
    expect(exit.kind).toBe("ok");
    await settleTurn(f.client, id);
    const running = await f.client.workbenchRead({ kind: "workflow-active" });
    expect(
      running.kind === "ok" &&
        running.value.kind === "workflow-active" &&
        running.value.runs.some((r) => r.id === runId),
    ).toBe(true);
    expect(
      (
        await f.client.workbenchCommand({
          kind: "workflow-cancel",
          commandId: randomUUID(),
          epoch: boot.value.epoch,
          runId,
        })
      ).kind,
    ).toBe("ok");
    let outcome = "running";
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      const r = await f.client.workbenchRead({ kind: "workflow", id: runId });
      if (
        r.kind === "ok" &&
        r.value.kind === "workflow" &&
        r.value.response.type === "run"
      )
        outcome = r.value.response.run.status;
      if (!["running", "queued"].includes(outcome)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(outcome).toBe("canceled");
    // Source drift while originals are live is intentionally a different fencing case.
    // Check model-independent exit only after the original workers/auth have settled.
    f.mode("coordinator");
    const off = await f.client.workbenchRead({
      kind: "cadence-conversation",
      id,
    });
    if (off.kind !== "ok" || off.value.kind !== "cadence-conversation")
      throw Error("off");
    const reentry = randomUUID();
    expect(
      (
        await f.client.workbenchCommand({
          kind: "cadence-send",
          commandId: reentry,
          conversationId: id,
          head: off.value.state.head,
          text: "/cadence",
          revision: off.value.state.revision,
          model: selected.value.version,
          intent: "enter",
        })
      ).kind,
    ).toBe("ok");
    await settleTurn(f.client, id);
    const on = await f.client.workbenchRead({
      kind: "cadence-conversation",
      id,
    });
    if (on.kind !== "ok" || on.value.kind !== "cadence-conversation")
      throw Error("on");
    writeFileSync(
      join(f.dir, "agent", "models.json"),
      JSON.stringify({ providers: {} }),
    );
    expect((await f.client.models()).kind).toBe("error");
    const exitedWithoutModel = await f.client.workbenchCommand({
      kind: "cadence-exit",
      commandId: randomUUID(),
      conversationId: id,
      head: reentry,
      revision: on.value.state.revision,
    });
    expect(
      exitedWithoutModel,
      JSON.stringify(exitedWithoutModel),
    ).toMatchObject({ kind: "ok" });
    await settleTurn(f.client, id);
  } finally {
    await other?.detach();
    await f.close();
  }
}, 60000);

it("generated owner reports fresh stale Sends as no-effect, but never reclassifies an accepted command ID", async () => {
  const f = await acceptingFixture("generated");
  try {
    f.mode("coordinator");
    expect((await f.client.session()).kind).toBe("ok");
    const catalog = await f.client.models();
    if (catalog.kind !== "ok") throw Error("catalog");
    const selected = await f.client.chooseModel({
      expected: catalog.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (selected.kind !== "ok") throw Error("model");
    const id = randomUUID(),
      first = randomUUID();
    const enter = {
      kind: "cadence-send" as const,
      commandId: first,
      conversationId: id,
      head: null,
      revision: 0,
      intent: "enter" as const,
      text: "/cadence",
      model: selected.value.version,
    };
    expect((await f.client.workbenchCommand(enter)).kind).toBe("ok");
    await settleTurn(f.client, id);
    const rejectedId = randomUUID(),
      contacts = f.contacts();
    const refused = await f.client.workbenchCommand({
      ...enter,
      commandId: rejectedId,
      head: first,
      intent: "message",
      text: "new requirement",
      revision: 0,
    });
    expect(refused).toMatchObject({
      kind: "error",
      error: { code: "stale", effect: "none", recovery: "fresh-confirmation" },
    });
    const view = await f.client.workbenchRead({
      kind: "conversation",
      id,
      before: null,
    });
    expect(
      view.kind === "ok" &&
        view.value.kind === "conversation" &&
        view.value.turns.some((t) => t.id === rejectedId),
    ).toBe(false);
    expect(f.contacts()).toBe(contacts);
    const replay = await f.client.workbenchCommand(enter);
    expect(replay).toMatchObject({
      kind: "error",
      error: { code: "stale", effect: "uncertain", recovery: "observe" },
    });
    const mode = await f.client.workbenchRead({
      kind: "cadence-conversation",
      id,
    });
    if (mode.kind !== "ok" || mode.value.kind !== "cadence-conversation")
      throw Error("mode");
    const wrongHead = await f.client.workbenchCommand({
      ...enter,
      commandId: randomUUID(),
      head: randomUUID(),
      intent: "message",
      revision: mode.value.state.revision,
    });
    expect(wrongHead).toMatchObject({
      kind: "error",
      error: { code: "stale", effect: "none" },
    });
    // Only a new explicit command proceeds; neither refusal replays anything.
    expect(
      (
        await f.client.workbenchCommand({
          ...enter,
          commandId: randomUUID(),
          head: first,
          intent: "message",
          revision: mode.value.state.revision,
        })
      ).kind,
    ).toBe("ok");
    await settleTurn(f.client, id);
    expect(f.contacts()).toBe(contacts + 1);
  } finally {
    await f.close();
  }
}, 30000);
