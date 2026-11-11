import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ContractError } from "../src/service/contracts/core.ts";
import {
  type ChatTurn,
  CONVERSATION_NAME_CHARS,
  CONVERSATION_SEND_BYTES,
  decodeChatItem,
  decodeChatSummary,
  decodeChatTurn,
  decodeWorkbenchCommand,
  decodeWorkbenchRead,
  decodeWorkbenchResult,
  FILE_DOWNLOAD_BYTES,
  FILE_PART_BYTES,
  PENDING_TEXT_BYTES,
  WAITING_INPUTS,
} from "../src/service/contracts/workbench.ts";
import { TurnCapture } from "../src/service/turn-capture.ts";
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
    decodeWorkbenchCommand({
      kind: "link-task",
      commandId: randomUUID(),
      epoch: randomUUID(),
      taskId: randomUUID(),
      conversationId: randomUUID(),
    }),
  ).toThrow();
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
    omitted: { thinking: false, media: false, other: false },
    items: [],
  };
  let saves = 0;
  const capture = new TurnCapture(
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

it("a download reads a file's exact bytes in parts that each fit one reply, binary and unredacted", () => {
  const root = mkdtempSync(join(tmpdir(), "wb-file-parts-"));
  const files = new WorkbenchFiles(root, [], () => ["unique-secret-value"]);
  // Not UTF-8, longer than two parts, and holding what a preview would redact.
  const bytes = Buffer.alloc(FILE_PART_BYTES * 2 + 5);
  for (let at = 0; at < bytes.length; at++) bytes[at] = (at * 31) % 256;
  bytes.write("token=unique-secret-value", 16, "latin1");
  writeFileSync(join(root, "blob.bin"), bytes);
  writeFileSync(join(root, "empty.bin"), "");
  expect(() => files.read("blob.bin")).toThrow();
  const parts: Buffer[] = [];
  let offset: number | null = 0,
    version = "";
  while (offset !== null) {
    const part = decodeWorkbenchResult(files.part("blob.bin", offset));
    if (part.kind !== "file-part") throw new Error("Missing part");
    expect(part.size).toBe(bytes.length);
    expect(part.data.length).toBeLessThanOrEqual((FILE_PART_BYTES / 3) * 4);
    version ||= part.version;
    expect(part.version).toBe(version);
    parts.push(Buffer.from(part.data, "base64"));
    offset = part.next;
  }
  expect(parts.map((part) => part.length)).toEqual([
    FILE_PART_BYTES,
    FILE_PART_BYTES,
    5,
  ]);
  expect(Buffer.concat(parts).equals(bytes)).toBe(true);
  expect(files.part("empty.bin", 0)).toMatchObject({
    size: 0,
    data: "",
    next: null,
  });
  // A changed file is another version; a part past its end is not its part.
  writeFileSync(join(root, "blob.bin"), bytes.subarray(0, FILE_PART_BYTES));
  const changed = files.part("blob.bin", 0);
  expect(changed.kind === "file-part" && changed.version).not.toBe(version);
  expect(() => files.part("blob.bin", FILE_PART_BYTES)).toThrow(
    expect.objectContaining({ code: "stale" }),
  );
  // Sparse, so no such file is written: only its size is over the bound.
  writeFileSync(join(root, "huge.bin"), "");
  truncateSync(join(root, "huge.bin"), FILE_DOWNLOAD_BYTES + 1);
  expect(() => files.part("huge.bin", 0)).toThrow(
    expect.objectContaining({ code: "oversize" }),
  );
});

it("a download keeps the preview's path refusals and its codec is closed and bounded", () => {
  const root = mkdtempSync(join(tmpdir(), "wb-file-part-paths-")),
    project = join(root, "project"),
    privateRoot = join(root, "private");
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(privateRoot, { mode: 0o700 });
  mkdirSync(join(project, "sub"), { mode: 0o700 });
  writeFileSync(join(privateRoot, "secret.txt"), "fabricated-credential");
  linkSync(join(privateRoot, "secret.txt"), join(project, "innocent.txt"));
  symlinkSync(join(privateRoot, "secret.txt"), join(project, "linked.txt"));
  writeFileSync(join(project, ".env"), "TOKEN=fabricated");
  writeFileSync(join(project, "id_ed25519"), "fabricated-private-key");
  const files = new WorkbenchFiles(project, [privateRoot], () => []);
  for (const path of [
    "innocent.txt",
    "linked.txt",
    ".env",
    "id_ed25519",
    "sub",
    "../private/secret.txt",
    join(privateRoot, "secret.txt"),
  ])
    expect(() => files.part(path, 0), path).toThrow(ContractError);
  const read = { kind: "file-part", path: "a.bin", offset: 0 };
  expect(decodeWorkbenchRead(read)).toEqual(read);
  expect(
    decodeWorkbenchRead({ ...read, offset: FILE_PART_BYTES * 3 }),
  ).toMatchObject({ offset: FILE_PART_BYTES * 3 });
  for (const bad of [
    { ...read, offset: 1 },
    { ...read, offset: -FILE_PART_BYTES },
    { ...read, offset: FILE_DOWNLOAD_BYTES },
    { ...read, version: "0".repeat(32) },
    { kind: "file-part", path: "a.bin" },
  ])
    expect(() => decodeWorkbenchRead(bad)).toThrow();
  const part = {
    kind: "file-part",
    path: "a.bin",
    size: 3,
    version: "0".repeat(32),
    data: "AAEC",
    next: null,
  };
  expect(decodeWorkbenchResult(part)).toEqual(part);
  for (const bad of [
    { ...part, data: "AAE" },
    { ...part, data: "AA\nEC" },
    { ...part, data: "A".repeat((FILE_PART_BYTES / 3) * 4 + 4) },
    { ...part, version: "not-a-version" },
    { ...part, size: FILE_DOWNLOAD_BYTES + 1 },
    { ...part, next: 1 },
    { ...part, next: FILE_PART_BYTES },
    { ...part, text: "extra" },
  ])
    expect(() => decodeWorkbenchResult(bad)).toThrow();
});

it("folder browsing names the home with ~ and refuses files and links instead of calling them unreadable", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "wb-browse-home-")));
  mkdirSync(join(home, "work", "project"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "notes.txt"), "plain");
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  try {
    const files = new WorkbenchFiles(home, [], () => []);
    const code = (path: string) => {
      try {
        files.list(path, true);
        return "listed";
      } catch (error) {
        return error instanceof ContractError ? error.code : "other";
      }
    };
    expect(files.list("~", true)).toMatchObject({ path: home });
    expect(files.list("~/work", true)).toMatchObject({
      path: join(home, "work"),
      entries: [{ name: "project", directory: true }],
    });
    expect(code(join(home, "missing"))).toBe("invalid");
    expect(code("work")).toBe("invalid");
    expect(code(join(home, "notes.txt"))).toBe("forbidden");
    if (process.platform !== "win32") {
      symlinkSync(join(home, "work"), join(home, "linked"), "dir");
      expect(code(join(home, "linked", "project"))).toBe("forbidden");
    }
    // Open's own resolution is unchanged: it still requires a full path.
    expect(() => files.directory("~")).toThrow(ContractError);
  } finally {
    vi.unstubAllEnvs();
  }
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
it("workbench reads are gzip-compressed only when accepted; session replies never are", async () => {
  const f = await httpFixture();
  const text = "retained conversation text ".repeat(400);
  f.adapters.workbench = {
    read: () => ({ kind: "file", path: "a.txt", text, limited: false }),
    command: () => {
      throw Error("no command");
    },
  };
  try {
    const bound = await session(f);
    const path = `/api/v1/workbench/read?request=${encodeURIComponent(
      JSON.stringify({ kind: "file", path: "a.txt" }),
    )}`;
    const plain = await request(f.origin, path, { headers: bound.headers });
    expect(plain.status).toBe(200);
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.headers.vary).toBe("Accept-Encoding");
    expect(JSON.parse(plain.text).value.text).toBe(text);
    const refused = await request(f.origin, path, {
      headers: { ...bound.headers, "accept-encoding": "gzip;q=0, identity" },
    });
    expect(refused.headers["content-encoding"]).toBeUndefined();
    const zipped = await fetch(`${f.origin}${path}`, {
      headers: { ...bound.headers, "accept-encoding": "gzip" },
    });
    expect(zipped.headers.get("content-encoding")).toBe("gzip");
    const body = (await zipped.json()) as { value: { text: string } };
    expect(body.value.text).toBe(text);
    const bootstrap = await fetch(`${f.origin}/api/v1/session`, {
      headers: { ...bound.headers, "accept-encoding": "gzip" },
    });
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.headers.get("content-encoding")).toBeNull();
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
    omitted: { thinking: false, media: false, other: false },
    items: [],
  };
  const capture = new TurnCapture(
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
it("omitted thinking, media and unknown blocks are flags that never displace a turn's notice", () => {
  const turn: ChatTurn = {
    id: randomUUID(),
    epoch: randomUUID(),
    status: "running",
    notice: "",
    omitted: { thinking: false, media: false, other: false },
    items: [],
  };
  const capture = new TurnCapture(
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
  const omitted = (
    owner: Extract<
      CaptureFrame["event"],
      { kind: "omitted-block" }
    >["block"]["owner"],
    reason: "hidden-thinking" | "binary" | "unsupported",
  ) =>
    emit({
      kind: "omitted-block",
      block: {
        owner,
        sourceType: reason === "binary" ? "image" : reason,
        mimeType: null,
        reason,
      },
    });
  // Continuation context belongs to earlier turns, not this one.
  omitted({ kind: "context", component: "request-context" }, "binary");
  expect(turn.omitted).toEqual({ thinking: false, media: false, other: false });
  omitted(
    { kind: "message", messageId: "m", blockId: "b", index: 0, stage: "final" },
    "hidden-thinking",
  );
  // An empty notice leaves room for the failure reason recorded when the turn ends.
  expect(turn.notice).toBe("");
  emit({ kind: "worker-failure", code: "model" });
  omitted(
    { kind: "tool", callId: "c", blockId: "b", index: 1, stage: "result" },
    "binary",
  );
  expect(turn.notice).toBe("worker-failure: model");
  expect(turn.omitted).toEqual({ thinking: true, media: true, other: false });
  // A block of a type Cadence does not recognize is neither thinking nor media.
  omitted(
    { kind: "message", messageId: "m", blockId: "c", index: 2, stage: "final" },
    "unsupported",
  );
  expect(turn.omitted).toEqual({ thinking: true, media: true, other: true });
  expect(decodeChatTurn(structuredClone(turn))).toEqual(turn);
});
it("turns saved before omissions were flagged still decode; other shapes stay closed", () => {
  const saved = {
    id: randomUUID(),
    epoch: randomUUID(),
    status: "completed",
    notice: "Hidden thinking, signatures and media are not retained.",
    items: [],
  };
  expect(decodeChatTurn(saved)).toEqual({
    ...saved,
    omitted: { thinking: false, media: false, other: false },
  });
  expect(() =>
    decodeChatTurn({ ...saved, omitted: { thinking: true, media: false } }),
  ).toThrow();
  expect(() =>
    decodeChatTurn({
      ...saved,
      omitted: { thinking: 1, media: false, other: false },
    }),
  ).toThrow();
  expect(() => decodeChatTurn({ ...saved, extra: true })).toThrow();
});
it("readable thinking is its own item role; no signature or other role is accepted", () => {
  const item = {
    id: "abcdef12:1",
    role: "thinking",
    text: "Weighing the options",
    name: "",
    args: "",
    error: false,
  };
  expect(decodeChatItem(item)).toEqual(item);
  expect(() => decodeChatItem({ ...item, role: "reasoning" })).toThrow();
  expect(() =>
    decodeChatItem({ ...item, thinkingSignature: "opaque" }),
  ).toThrow();
});
it("the conversation head's context size is an optional closed key an older owner omits", () => {
  const head = {
    kind: "conversation",
    summary: null,
    leaf: null,
    continues: true,
    turns: 0,
    branches: 0,
    runs: [],
    attempt: null,
  };
  expect(decodeWorkbenchResult(head)).not.toHaveProperty("context");
  const context = { tokens: 1200, provider: "fixture", model: "fixed" };
  expect(decodeWorkbenchResult({ ...head, context })).toEqual({
    ...head,
    context,
  });
  // Unknown after a compaction is stated, not left out.
  expect(
    decodeWorkbenchResult({ ...head, context: { ...context, tokens: null } }),
  ).toMatchObject({ context: { tokens: null } });
  for (const refused of [
    { ...context, tokens: 0 },
    { ...context, tokens: 1.5 },
    { ...context, contextWindow: 200000 },
    { tokens: 1, provider: "fixture" },
    { ...context, model: 7 },
    null,
  ])
    expect(() =>
      decodeWorkbenchResult({ ...head, context: refused }),
    ).toThrow();
});
it("a turn header's parent entry is an optional key an older owner omits", () => {
  const read = {
    kind: "conversation-turn",
    conversationId: randomUUID(),
    leaf: "abcdef12",
    ordinal: 0,
    turn: {
      id: "abcdef12",
      status: "completed",
      notice: "",
      omitted: { thinking: false, media: false, other: false },
      steps: 0,
      stable: 0,
      entry: "abcdef12",
      at: 0,
    },
    start: 0,
    steps: [],
  };
  expect(decodeWorkbenchResult(read)).toEqual(read);
  // A root message continues nothing; that is stated, unlike an unknown parent.
  for (const parent of [null, "0123abcd"])
    expect(
      decodeWorkbenchResult({ ...read, turn: { ...read.turn, parent } }),
    ).toMatchObject({ turn: { parent } });
  for (const parent of ["", "has space", 7, undefined])
    expect(() =>
      decodeWorkbenchResult({ ...read, turn: { ...read.turn, parent } }),
    ).toThrow();
});
it("rename and archive are closed commands; a name is exactly the one line Pi would record", () => {
  const rename = {
    kind: "conversation-rename",
    commandId: randomUUID(),
    conversationId: randomUUID(),
    name: "Release notes 发布说明 👨‍👩‍👧",
  };
  expect(decodeWorkbenchCommand(rename)).toEqual(rename);
  // Empty clears the name; the bound counts code points, not bytes.
  for (const name of ["", "名".repeat(CONVERSATION_NAME_CHARS)])
    expect(decodeWorkbenchCommand({ ...rename, name })).toMatchObject({ name });
  for (const name of [
    " padded",
    "padded ",
    "two\nlines",
    "tab\tbed",
    "nul\u0000",
    "x".repeat(CONVERSATION_NAME_CHARS + 1),
    7,
    undefined,
  ])
    expect(() => decodeWorkbenchCommand({ ...rename, name })).toThrow();
  expect(() => decodeWorkbenchCommand({ ...rename, head: null })).toThrow();
  const archive = {
    kind: "conversation-archive",
    commandId: randomUUID(),
    conversationId: randomUUID(),
    archived: true,
  };
  expect(decodeWorkbenchCommand(archive)).toEqual(archive);
  expect(decodeWorkbenchCommand({ ...archive, archived: false })).toMatchObject(
    { archived: false },
  );
  for (const refused of [
    { ...archive, archived: "yes" },
    { ...archive, conversationId: "../escape" },
    { kind: archive.kind, commandId: archive.commandId, archived: true },
  ])
    expect(() => decodeWorkbenchCommand(refused)).toThrow();
});
it("the archived listing and flag are optional keys that can only say true", () => {
  expect(decodeWorkbenchRead({ kind: "conversations" })).toEqual({
    kind: "conversations",
  });
  expect(
    decodeWorkbenchRead({ kind: "conversations", after: null, archived: true }),
  ).toEqual({ kind: "conversations", after: null, archived: true });
  for (const archived of [false, null, "true"])
    expect(() =>
      decodeWorkbenchRead({ kind: "conversations", archived }),
    ).toThrow();
  const summary = {
    id: randomUUID(),
    title: "Conversation",
    leaf: null,
    status: "completed",
    updatedAt: 0,
    origin: "terminal",
  };
  // An older owner's summary has no flag at all.
  expect(decodeChatSummary(summary)).toEqual(summary);
  expect(decodeChatSummary({ ...summary, archived: true })).toEqual({
    ...summary,
    archived: true,
  });
  expect(() => decodeChatSummary({ ...summary, archived: false })).toThrow();
});
it("a message for a running reply and its withdrawal are closed commands that name the run, never a head, model or image", () => {
  const input = {
    kind: "conversation-input",
    commandId: randomUUID(),
    conversationId: randomUUID(),
    turnId: randomUUID(),
    epoch: randomUUID(),
    mode: "steer",
    text: "Look at the tests first 先看测试",
  };
  expect(decodeWorkbenchCommand(input)).toEqual(input);
  expect(decodeWorkbenchCommand({ ...input, mode: "queue" })).toMatchObject({
    mode: "queue",
  });
  expect(
    decodeWorkbenchCommand({
      ...input,
      text: "x".repeat(CONVERSATION_SEND_BYTES),
    }),
  ).toMatchObject({ kind: "conversation-input" });
  for (const refused of [
    { ...input, mode: "followUp" },
    { ...input, text: "" },
    { ...input, text: " \n" },
    { ...input, text: "x".repeat(CONVERSATION_SEND_BYTES + 1) },
    { ...input, turnId: "latest" },
    { ...input, head: null },
    { ...input, images: [randomUUID()] },
    { ...input, model: {} },
    { ...input, epoch: undefined },
  ])
    expect(() => decodeWorkbenchCommand(refused)).toThrow();
  const { mode: _mode, text: _text, ...run } = input;
  const withdrawal = {
    ...run,
    kind: "conversation-input-cancel",
    inputId: randomUUID(),
  };
  expect(decodeWorkbenchCommand(withdrawal)).toEqual(withdrawal);
  for (const refused of [
    { ...withdrawal, inputId: "newest" },
    { ...withdrawal, text: "x" },
    run,
  ])
    expect(() => decodeWorkbenchCommand(refused)).toThrow();
  // Stop still names only the run.
  expect(() =>
    decodeWorkbenchCommand({
      ...run,
      kind: "interrupt",
      inputId: randomUUID(),
    }),
  ).toThrow();
});
it("waiting and undelivered messages are optional closed keys of the conversation head", () => {
  const head = {
    kind: "conversation",
    summary: null,
    leaf: null,
    continues: true,
    turns: 0,
    branches: 0,
    runs: [],
    attempt: null,
  };
  const decoded = decodeWorkbenchResult(head);
  expect(decoded).not.toHaveProperty("pending");
  expect(decoded).not.toHaveProperty("undelivered");
  const waiting = { commandId: randomUUID(), mode: "queue", text: "Later" };
  const lost = {
    commandId: randomUUID(),
    text: "Never delivered",
    status: "canceled",
    notice: "Not delivered",
  };
  const full = { ...head, pending: [waiting], undelivered: [lost] };
  expect(decodeWorkbenchResult(full)).toEqual(full);
  for (const refused of [
    { pending: [{ ...waiting, mode: "followUp" }] },
    { pending: [{ ...waiting, text: "x".repeat(PENDING_TEXT_BYTES + 1) }] },
    { pending: [{ ...waiting, status: "queued" }] },
    { pending: Array.from({ length: WAITING_INPUTS + 1 }, () => waiting) },
    { pending: null },
    { undelivered: [{ ...lost, mode: "queue" }] },
    { undelivered: [{ ...lost, status: "withdrawn" }] },
    { undelivered: Array.from({ length: WAITING_INPUTS + 1 }, () => lost) },
  ])
    expect(() => decodeWorkbenchResult({ ...head, ...refused })).toThrow();
});
