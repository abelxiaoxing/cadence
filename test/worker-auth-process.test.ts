// @module-tag slow
/** Real worker/public SDK/IPC; only the owner auth port and loopback model are fixtures. */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import type { PreparedModelContext } from "../src/service/model-context.ts";
import {
  launchConversation,
  launchWorkflowWorker,
  legacyWorkerEnvelope,
} from "../src/subagent-process.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";

afterEach(() => vi.unstubAllEnvs());
it.each(["conversation", "coordinator", "workflow"] as const)(
  "%s completes a real SDK request through the owner's private auth channel",
  async (route) => {
    const dir = mkdtempSync(join(tmpdir(), "worker-auth-process-"));
    for (const name of ["project", "agent", "home", "sessions"])
      mkdirSync(join(dir, name), { mode: 0o700 });
    vi.stubEnv("HOME", join(dir, "home"));
    for (const name of [
      "http_proxy",
      "https_proxy",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "all_proxy",
      "ALL_PROXY",
      "no_proxy",
      "NO_PROXY",
      "NODE_USE_ENV_PROXY",
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
    ])
      vi.stubEnv(name, undefined);
    let contacts = 0;
    const server = createServer(async (req, res) => {
      for await (const _ of req) {
        /* read request */
      }
      contacts++;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      for (const [delta, finish_reason] of [
        [{ role: "assistant", content: "Isolated reply" }, null],
        [{}, "stop"],
      ])
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixed", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw Error("fixture address");
    const model: Model<"openai-completions"> = {
      id: "fixed",
      name: "Fixture",
      provider: "fixture",
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      reasoning: false,
      input: ["text"],
      contextWindow: 64000,
      maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const cwd = join(dir, "project");
    const envelope = legacyWorkerEnvelope({
      cwd,
      model: { ...model },
      kind: route === "coordinator" ? "research" : "code",
      auth: { ok: true, apiKey: "fabricated-worker-auth-key" },
      prompt: "Reply briefly without tools",
      instructions: "Reply briefly.",
    });
    const refreshAuth = vi.fn(async () => envelope.auth);
    const prepared: PreparedModelContext = {
      consume: (encode, use) => use(encode({ ...envelope, model })),
      refreshAuth,
    };
    const abort = new AbortController();
    let running: ReturnType<typeof launchConversation> | undefined;
    try {
      running =
        route === "workflow"
          ? launchWorkflowWorker(prepared, cwd, abort.signal, {
              ownerSecrets: [],
              maySignal: () => true,
              onNative() {},
              onFrame() {},
            })
          : launchConversation(
              prepared,
              {
                session: {
                  id: randomUUID(),
                  dir: join(dir, "sessions"),
                  file: null,
                  head: null,
                },
                agentDir: join(dir, "agent"),
                ...(route === "coordinator"
                  ? { coordinator: true as const }
                  : {}),
              },
              abort.signal,
              {
                ownerSecrets: () => [],
                maySignal: () => true,
                onNative() {},
                onFrame() {},
                ...(route === "coordinator"
                  ? { onCoordinator: async () => ({}) }
                  : {}),
              },
            );
      const result = await running;
      expect(result.outcome, JSON.stringify(result)).toBe("completed");
      expect(result.closed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.text).toBe("Isolated reply");
      expect(contacts).toBe(1);
      expect(refreshAuth.mock.calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      abort.abort();
      await running;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it("browser HTTP Send persists a successful real-worker turn instead of native-or-protocol-failure", async () => {
  const f = await acceptingFixture("generated");
  try {
    expect((await f.client.session()).kind).toBe("ok");
    const catalog = await f.client.models();
    if (catalog.kind !== "ok") throw Error("fixture catalog");
    const chosen = await f.client.chooseModel({
      expected: catalog.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (chosen.kind !== "ok") throw Error("fixture choice");
    f.reply("Authenticated reply.");
    const id = randomUUID();
    const commandId = randomUUID();
    expect(
      await f.client.workbenchCommand({
        kind: "send",
        commandId,
        conversationId: id,
        head: null,
        text: "Reply briefly",
        model: chosen.value.version,
      }),
    ).toMatchObject({ kind: "ok", value: { kind: "accepted", commandId } });
    let completed = false;
    for (let attempt = 0; attempt < 750; attempt++) {
      const response = await f.client.workbenchRead({
        kind: "conversation",
        id,
        leaf: null,
        known: null,
      });
      if (response.kind !== "ok" || response.value.kind !== "conversation")
        throw Error("fixture conversation");
      const view = response.value;
      if (view.summary && !view.summary.live) {
        expect(view.summary.status, JSON.stringify(view.summary)).toBe(
          "completed",
        );
        expect(view.turns).toBe(1);
        completed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(completed).toBe(true);
    const command = join(
      f.c.directory,
      "conversation-commands-v1",
      "commands",
      commandId,
    );
    expect(
      JSON.parse(readFileSync(join(command, "state.json"), "utf8")),
    ).toMatchObject({
      status: "completed",
      notice: "",
      user: expect.any(String),
    });
    expect(
      JSON.parse(readFileSync(join(command, "native.json"), "utf8")),
    ).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      closure: "direct-child-closed",
    });
    expect(f.contacts()).toBe(1);
  } finally {
    await f.close();
  }
});
