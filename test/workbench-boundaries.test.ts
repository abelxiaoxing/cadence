import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { conversationMessages } from "../src/conversation-context.mjs";
import {
  type ChatTurn,
  decodeChatTurn,
  decodeWorkbenchCommand,
  decodeWorkbenchRead,
} from "../src/service/contracts/workbench.ts";
import { ConversationCapture } from "../src/service/conversations.ts";
import { WorkbenchFiles } from "../src/service/workbench-files.ts";
import type { CaptureFrame } from "../src/worker-public.mjs";
import {
  httpFixture,
  request,
  session,
} from "./helpers/service-http-fixture.ts";

it("workbench codecs are closed, do not invoke getters, and reject implicit execution shapes", () => {
  let calls = 0;
  const getter = {
    get kind() {
      calls++;
      return "send";
    },
  };
  expect(() => decodeWorkbenchCommand(getter)).toThrow();
  expect(calls).toBe(0);
  expect(() =>
    decodeWorkbenchRead({ kind: "files", path: "", command: "ls" }),
  ).toThrow();
  expect(() =>
    decodeWorkbenchCommand({ kind: "send", text: "unbound" }),
  ).toThrow();
  expect(() =>
    decodeWorkbenchCommand({ kind: "start", taskId: randomUUID() }),
  ).toThrow();
});
it("chat streams hold split secrets and keep finalized text separate from tool results", () => {
  const turn: ChatTurn = {
    id: randomUUID(),
    epoch: randomUUID(),
    status: "running",
    notice: "",
    items: [],
  };
  let saves = 0;
  const capture = new ConversationCapture(
    turn,
    () => {
      saves++;
    },
    () => ["private-literal"],
  );
  const emit = (event: CaptureFrame["event"]) =>
    capture.accept({
      protocol: 2,
      childRunId: randomUUID(),
      workerSeq: 1,
      observedMs: 0,
      event,
    });
  emit({
    kind: "message-start",
    messageId: "m",
    role: "assistant",
    source: { disposition: "unavailable", value: null },
    resultCallId: null,
  });
  emit({
    kind: "detail-begin",
    detailId: "d",
    descriptor: {
      owner: { kind: "message-final", messageId: "m" },
      field: "final-text",
      encoding: "utf8",
    },
  });
  emit({
    kind: "detail-chunk",
    detailId: "d",
    offset: 0,
    text: "answer private-lit",
  });
  expect(JSON.stringify(turn)).not.toContain("private-lit");
  emit({
    kind: "detail-chunk",
    detailId: "d",
    offset: 18,
    text: "eral answer",
  });
  emit({
    kind: "detail-end",
    detailId: "d",
    bytes: 29,
    sha256: "a".repeat(64),
    coverage: {
      observed: "complete",
      source: "complete",
      redacted: false,
      omissions: [],
    },
  });
  expect(turn.items[0].text).toContain("answer");
  expect(JSON.stringify(turn)).not.toContain("private-literal");
  expect(saves).toBe(0);
});
it("continuation keeps tool exchanges but strips hidden/media/signatures and owner credentials", () => {
  const messages = [
    { role: "user", content: "hello", timestamp: 1 },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "HIDDEN" },
        {
          type: "text",
          text: "visible owner-literal",
          textSignature: "OPAQUE",
        },
        {
          type: "toolCall",
          id: "c",
          name: "read",
          arguments: { path: "a", secret: "owner-literal" },
          thoughtSignature: "OPAQUE",
        },
      ],
      timestamp: 2,
      api: "openai-completions",
      provider: "fixture",
      model: "fixed",
      stopReason: "toolUse",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
    {
      role: "toolResult",
      toolCallId: "c",
      toolName: "read",
      isError: false,
      timestamp: 3,
      content: [
        { type: "text", text: "file owner-literal" },
        { type: "image", data: "MEDIA" },
      ],
      details: { raw: "RAW" },
    },
  ];
  const result = conversationMessages(messages, ["owner-literal"]),
    source = JSON.stringify(result);
  for (const secret of ["HIDDEN", "OPAQUE", "MEDIA", "RAW", "owner-literal"])
    expect(source).not.toContain(secret);
  expect(source).toContain("toolCall");
  expect(source).toContain("toolResult");
});
it("file previews do not flush a truncated credential prefix or browse private state", () => {
  const root = mkdtempSync(join(tmpdir(), "wb-files-")),
    excluded = join(root, "private");
  mkdirSync(excluded, { mode: 0o700 });
  const files = new WorkbenchFiles(root, [excluded], () => [
    "unique-secret-value",
  ]);
  writeFileSync(
    join(root, "long.txt"),
    `${"a".repeat(128 * 1024 - 7)}unique-secret-value`,
  );
  const result = files.read("long.txt");
  expect(result).toMatchObject({ kind: "file", limited: true });
  expect(JSON.stringify(result)).not.toContain("unique-");
  expect(() => files.list("private")).toThrow();
  expect(() => files.read("../other")).toThrow();
});

it("file previews refuse hard-linked private files and hide credential paths", () => {
  const root = mkdtempSync(join(tmpdir(), "wb-private-files-")),
    project = join(root, "project"),
    privateRoot = join(root, "private");
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(privateRoot, { mode: 0o700 });
  const secret = join(privateRoot, "secret.txt");
  writeFileSync(secret, "fabricated-unlisted-credential", { mode: 0o600 });
  linkSync(secret, join(project, "innocent.txt"));
  writeFileSync(join(project, ".npmrc"), "//registry.invalid/:_authToken=fake");
  mkdirSync(join(project, ".ssh"), { mode: 0o700 });
  writeFileSync(join(project, ".ssh", "id_ed25519"), "fabricated-private-key");
  const files = new WorkbenchFiles(project, [privateRoot], () => []);
  expect(() => files.read("innocent.txt")).toThrow();
  expect(() => files.read(".npmrc")).toThrow();
  expect(() => files.read(".ssh/id_ed25519")).toThrow();
  expect(() => files.list(join(project, ".ssh"), true)).toThrow();
  const listing = files.list("");
  expect(listing.kind).toBe("files");
  if (listing.kind !== "files") throw new Error("Missing files");
  expect(listing.entries).toEqual([]);
});

it.skipIf(process.platform === "win32")(
  "private directory exclusions follow their configured aliases without exposing the target",
  () => {
    const root = mkdtempSync(join(tmpdir(), "wb-private-alias-")),
      target = join(root, "actual-agent"),
      alias = join(root, "agent");
    mkdirSync(target, { mode: 0o700 });
    writeFileSync(join(target, "credentials.txt"), "fabricated-secret");
    symlinkSync(target, alias, "dir");
    const files = new WorkbenchFiles(root, [alias], () => []);
    expect(() => files.read("actual-agent/credentials.txt")).toThrow();
    expect(() => files.list(target, true)).toThrow();
  },
);

it("workbench commands retain browser Origin/CSRF/build/attachment checks before any adapter effect", async () => {
  const f = await httpFixture();
  let calls = 0;
  f.adapters.workbench = {
    read: () => ({ kind: "projects", entries: [] }),
    command: (value) => {
      calls++;
      return { kind: "accepted", commandId: value.commandId };
    },
  };
  try {
    const bound = await session(f);
    const body = JSON.stringify({
      kind: "interrupt",
      commandId: randomUUID(),
      conversationId: randomUUID(),
      turnId: randomUUID(),
      epoch: f.epoch,
    });
    const changes: Record<string, string>[] = [
      { cookie: "" },
      { origin: "https://foreign.invalid" },
      { "x-cadence-csrf": "wrong" },
      { "x-cadence-build": "{}" },
      { "x-cadence-attachment": randomUUID() },
    ];
    for (const change of changes) {
      const reply = await request(f.origin, "/api/v1/workbench/command", {
        method: "POST",
        headers: { ...bound.headers, ...change },
        body,
      });
      expect(reply.status).not.toBe(200);
    }
    expect(calls).toBe(0);
    expect(
      (
        await request(f.origin, "/api/v1/workbench/command", {
          method: "POST",
          headers: bound.headers,
          body,
        })
      ).status,
    ).toBe(200);
    expect(calls).toBe(1);
  } finally {
    await f.server.close();
  }
});

it("oversize tool arguments stop capture without poisoning the last readable turn", () => {
  const turn: ChatTurn = {
    id: randomUUID(),
    epoch: randomUUID(),
    status: "running",
    notice: "",
    items: [],
  };
  const capture = new ConversationCapture(
    turn,
    () => {},
    () => [],
  );
  let sequence = 0;
  const emit = (event: CaptureFrame["event"]) =>
    capture.accept({
      protocol: 2,
      childRunId: "child",
      workerSeq: ++sequence,
      observedMs: 0,
      event,
    });
  emit({
    kind: "detail-begin",
    detailId: "large",
    descriptor: {
      owner: {
        kind: "tool",
        callId: "call",
        blockId: "block",
        index: 0,
        stage: "execution-arguments",
      },
      field: "tool-args",
      encoding: "canonical-json",
    },
  });
  const source = JSON.stringify({ content: "x".repeat(80000) });
  expect(() => {
    for (let offset = 0; offset < source.length; offset += 8192)
      emit({
        kind: "detail-chunk",
        detailId: "large",
        offset,
        text: source.slice(offset, offset + 8192),
      });
  }).toThrow();
  expect(() => decodeChatTurn(turn)).not.toThrow();
  expect(Buffer.byteLength(turn.items[0].args)).toBeLessThanOrEqual(64 * 1024);
  expect(turn.notice).toContain("limit exceeded");
});
