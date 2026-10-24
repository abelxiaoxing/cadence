import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryFiles, HistoryReadBudget } from "../src/history/files.ts";
import { HistoryReadProof } from "../src/history/read-proof.ts";
import {
  decodeSha256State,
  ResumableSha256,
} from "../src/history/sha256-state.ts";
import { HistoryWriter } from "../src/history/writer.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { ServiceClient } from "../src/service-client.ts";
import {
  decodeCursor,
  decodeDetailReadResult,
  decodeHistoryReadResult,
  decodeListRequest,
  decodeSearchPage,
  LIMITS,
  type ReadCursor,
} from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { readRoute, wireRequest } from "../src/service-wire.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import {
  type Fixture,
  httpFixture,
  request,
  session,
} from "./helpers/service-http-fixture.ts";

const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.server.close();
});
function cursor(): ReadCursor {
  return {
    storeId: randomUUID(),
    scope: { kind: "run", id: randomUUID() },
    query: "q".repeat(1024),
    snapshotSeq: "1",
    recordId: null,
    recordVersion: null,
    field: null,
    offset: 0,
  };
}
const coverage = () => ({
  observed: "complete" as const,
  source: "complete" as const,
  redacted: false,
  omissions: [],
});
describe("additive read navigation transport (injected projection, actual HTTP)", () => {
  it("admits an optional bounded ASCII navigation field without changing ordinary cursor bytes", () => {
    const seed = cursor();
    expect(decodeCursor(seed)).toEqual(seed);
    expect(decodeCursor({ ...seed, navigation: "a".repeat(8192) })).toEqual({
      ...seed,
      navigation: "a".repeat(8192),
    });
    for (const navigation of [
      "",
      null,
      undefined,
      "a".repeat(8193),
      "雪",
      "a\n",
    ]) {
      expect(() => decodeCursor({ ...seed, navigation })).toThrow();
    }
  });
  it("roundtrips maximal navigation and query through the named POST without mutation authority", async () => {
    let calls = 0;
    const f = await httpFixture(
      undefined,
      {
        search: async (input) => {
          calls++;
          return { cursor: input, hits: [], next: null, coverage: coverage() };
        },
      },
      { environment: "c".repeat(1024) },
    );
    fixtures.push(f);
    const transport = new HttpServiceTransport({
      origin: f.origin,
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          headers: {
            ...init?.headers,
            cookie: f.cookie,
            ...(init?.method === "POST" ? { origin: f.origin } : {}),
          },
        }),
    });
    const client = new ServiceClient(transport);
    expect((await client.session()).kind).toBe("ok");
    const input = { ...cursor(), navigation: "a".repeat(8192) };
    expect(await client.search(input)).toEqual({
      kind: "ok",
      value: { cursor: input, hits: [], next: null, coverage: coverage() },
    });
    expect(calls).toBe(1);
    expect(f.adapters.admission).toBeNull();
  });
  it("keeps small GET and authenticates readonly POST before private parsing", async () => {
    let calls = 0;
    const f = await httpFixture(undefined, {
      search: async (input) => {
        calls++;
        return { cursor: input, hits: [], next: null, coverage: coverage() };
      },
    });
    fixtures.push(f);
    const input = { ...cursor(), query: "q" };
    const s = await session(f);
    expect(
      (
        await request(
          f.origin,
          `/api/v1/search?request=${encodeURIComponent(JSON.stringify(input))}`,
          { headers: { cookie: f.cookie } },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(f.origin, "/api/v1/search", {
          method: "POST",
          headers: s.headers,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(200);
    const denied = await request(f.origin, "/api/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not JSON",
    });
    expect(denied.status).toBe(401);
    expect(JSON.parse(denied.text).error.effect).toBe("none");
    expect(calls).toBe(2);
  });
});

describe("portable data-or-progress correlation (not cryptographic proof)", () => {
  it("keeps byte ranges strict and admits proof-only detail/list without fabricated data", async () => {
    const seed = cursor(),
      next = { ...seed, navigation: "a".repeat(8192) };
    const detail = {
      kind: "progress" as const,
      cursor: seed,
      next,
      coverage: coverage(),
    };
    expect(decodeDetailReadResult(detail)).toEqual(detail);
    for (const bad of [
      { ...detail, text: "" },
      { ...detail, next: seed },
      { ...detail, next: { ...next, offset: 1 } },
      { ...detail, next: { ...next, query: "other" } },
    ])
      expect(() => decodeDetailReadResult(bad)).toThrow();
    const input = decodeListRequest({
      reader: "runs",
      storeId: seed.storeId,
      scope: seed.scope,
      snapshotSeq: "1",
      after: null,
      limit: 50,
    });
    const progress = {
      kind: "progress" as const,
      request: input,
      next: { ...input, navigation: "opaque" },
      coverage: coverage(),
    };
    expect(decodeHistoryReadResult(progress)).toEqual(progress);
    expect(() =>
      decodeHistoryReadResult({ ...progress, records: [] }),
    ).toThrow();
    expect(() =>
      decodeHistoryReadResult({
        ...progress,
        next: { ...progress.next, reader: "tools" },
      }),
    ).toThrow();
    const page = { cursor: seed, hits: [], next, coverage: coverage() };
    expect(decodeSearchPage(page)).toEqual(page);
    expect(() => decodeSearchPage({ ...page, cursor: next })).toThrow();
    const f = await httpFixture(undefined, {
      detail: async () => detail,
      runs: async () => progress,
      validateCursor: async () => ({ status: "progress-needed" }),
    });
    fixtures.push(f);
    const client = new ServiceClient(
      new HttpServiceTransport({ origin: f.origin, localCapability: f.local }),
    );
    expect(await client.detail(seed)).toEqual({ kind: "ok", value: detail });
    const { reader: _reader, ...listInput } = input;
    expect(await client.runs(listInput)).toEqual({
      kind: "ok",
      value: progress,
    });
    expect((await client.detail({ ...seed, offset: 1 })).kind).toBe("error");
  });
  it("rejects mixed query/body, malformed JSON/UTF8/type/encoding, CSRF and oversized input without invoking readers", async () => {
    let reads = 0;
    const f = await httpFixture(undefined, {
      search: async () => {
        reads++;
        throw new Error("must not read");
      },
    });
    fixtures.push(f);
    const s = await session(f),
      input = { ...cursor(), query: "q" };
    for (const [path, headers, body] of [
      ["/api/v1/search?request=null", s.headers, JSON.stringify(input)],
      ["/api/v1/search", s.headers, '{"query":"a","query":"b"}'],
      ["/api/v1/search", s.headers, Buffer.from([0xc3, 0x28])],
      [
        "/api/v1/search",
        { ...s.headers, "content-type": "text/plain" },
        JSON.stringify(input),
      ],
      [
        "/api/v1/search",
        { ...s.headers, "content-encoding": "gzip" },
        JSON.stringify(input),
      ],
      [
        "/api/v1/search",
        { ...s.headers, "x-cadence-csrf": "wrong" },
        JSON.stringify(input),
      ],
      [
        "/api/v1/search",
        { ...s.headers, origin: "https://other.example" },
        JSON.stringify(input),
      ],
      ["/api/v1/search", s.headers, "a".repeat(LIMITS.controlBytes + 1)],
    ] as const) {
      const sent = request(f.origin, path, {
        method: "POST",
        headers,
        body,
      });
      // The oversized refusal closes the connection with request bytes still
      // unread; Windows answers that with a reset the client may see before
      // the response (twice on a Node 22 runner, CI 40097062181). Either way
      // nothing was read.
      if (Buffer.byteLength(body) > LIMITS.controlBytes) {
        const result = await sent.catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ECONNRESET") throw error;
          return undefined;
        });
        if (!result) continue;
        expect(result.status).toBeGreaterThanOrEqual(400);
        expect(JSON.parse(result.text).error.effect).toBe("none");
        continue;
      }
      const result = await sent;
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(JSON.parse(result.text).error.effect).toBe("none");
    }
    expect(() => readRoute("/api/v1/search?", "POST")).toThrow();
    expect(reads).toBe(0);
  });
});

describe("transport selection and authority separation", () => {
  it("selects POST before send and never bootstraps or retries on its own", async () => {
    const seed = { ...cursor(), query: "q" };
    expect(wireRequest("search", seed).method).toBe("GET");
    expect(wireRequest("search", { ...seed, navigation: "small" }).method).toBe(
      "POST",
    );
    expect(
      wireRequest("search", { ...seed, query: "\\".repeat(1024) }).method,
    ).toBe("POST");
    expect(() => readRoute("/api/v1/session", "POST")).toThrow();
    expect(() => readRoute("/api/v1/workspace", "POST")).toThrow();
    let sends = 0;
    const transport = new HttpServiceTransport({
      origin: "http://127.0.0.1:17423",
      fetch: async () => {
        sends++;
        throw new Error("not sent");
      },
    });
    await expect(
      transport.search({ ...seed, navigation: "opaque" }),
    ).rejects.toThrow("stale");
    expect(sends).toBe(0);
  });
  it("uses readonly POST for large export input with exact trailer/EOF and no replay", async () => {
    const f = await httpFixture();
    fixtures.push(f);
    const methods: string[] = [];
    const transport = new HttpServiceTransport({
      origin: f.origin,
      localCapability: f.local,
      fetch: (url, init) => {
        methods.push(init?.method ?? "GET");
        return fetch(url, init);
      },
    });
    const client = new ServiceClient(transport);
    await client.session();
    const frames = [];
    for await (const frame of client.export(
      {
        storeId: f.storeId,
        scope: f.scope,
        snapshotSeq: "1".repeat(4000),
        format: "ndjson",
      },
      new AbortController().signal,
    ))
      frames.push(frame);
    expect(methods).toEqual(["GET", "POST"]);
    expect(frames.map((frame) => frame.event.kind)).toEqual([
      "manifest",
      "trailer",
    ]);
  });
  it("does not treat navigation as HTTP access or a task action", async () => {
    let reads = 0;
    const f = await httpFixture(undefined, {
      search: async () => {
        reads++;
        throw new Error("not reached");
      },
    });
    fixtures.push(f);
    const seed = { ...cursor(), navigation: "a".repeat(8192) },
      s = await session(f);
    const denied = await request(f.origin, "/api/v1/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: f.origin,
        "x-cadence-csrf": s.value.csrf,
      },
      body: JSON.stringify(seed),
    });
    expect(denied.status).toBe(401);
    expect(reads).toBe(0);
    for (const path of [
      "/api/v1/preflight",
      "/api/v1/commands",
      "/api/v1/cancel",
    ]) {
      const result = await request(f.origin, path, {
        method: "POST",
        headers: s.headers,
        body: JSON.stringify(seed),
      });
      expect(result.status).toBe(400);
      expect(JSON.parse(result.text).error.effect).toBe("none");
    }
    const stale = s.headers;
    f.material.rotate();
    expect(
      (
        await request(f.origin, "/api/v1/search", {
          method: "POST",
          headers: stale,
          body: JSON.stringify(seed),
        })
      ).status,
    ).toBe(401);
    expect(reads).toBe(0);
  });
});

describe("new-only format3 and private read proof primitive", () => {
  it("flushes a single private 32-byte key at explicit initialization; legacy2 stays readonly", () => {
    const f = historyFixture(),
      path = join(f.files.directory, "read-proof-key.json");
    expect(f.files.format.schema).toBe("cadence-history-store/3");
    const key = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(key).sort()).toEqual(["key", "schema", "storeId"]);
    expect(Buffer.from(key.key, "base64url")).toHaveLength(32);
    if (process.platform !== "win32")
      expect(lstatSync(path).mode & 0o777).toBe(0o600);
    expect(HistoryFiles.initialize(f.lease).format).toEqual(f.files.format);
    const formatPath = join(f.files.directory, "format.json");
    writeFileSync(
      formatPath,
      JSON.stringify({ ...f.files.format, schema: "cadence-history-store/2" }),
      { mode: 0o600 },
    );
    renameSync(path, join(f.dir, "preserved-format3-key.json"));
    const before = readFileSync(formatPath);
    const old = HistoryFiles.open(f.c)!;
    expect(old.inspect().committedSeq).toBe("0");
    expect(() => new HistoryWriter(f.lease)).toThrow();
    expect(() => HistoryFiles.initialize(f.lease)).toThrow();
    expect(() => old.assertWritable()).toThrow();
    expect(readFileSync(formatPath)).toEqual(before);
    expect(existsSync(path)).toBe(false);
    expect(
      JSON.parse(
        readFileSync(join(f.dir, "preserved-format3-key.json"), "utf8"),
      ),
    ).toEqual(key);
  });
  it("preserves passive absence and partial key-only initialization without adoption", () => {
    const dir = mkdtempSync(join(tmpdir(), "progress-absent-")),
      root = join(dir, "root");
    mkdirSync(root);
    const c = new ServiceCoordination(root, join(dir, "state"));
    expect(HistoryFiles.open(c)).toBeUndefined();
    const lease = c.acquire({
      schema: "cadence-service-owner-config/1",
      endpoint: "http://127.0.0.1:17423",
      policyIdentity: "a".repeat(64),
    });
    const path = join(c.directory, "history-v2", "read-proof-key.json");
    c.files.create(path, "partial");
    expect(() => HistoryFiles.initialize(lease)).toThrow();
    expect(readFileSync(path, "utf8")).toBe("partial");
    expect(existsSync(join(c.directory, "history-v2", "format.json"))).toBe(
      false,
    );
  });
  it("seals maximal private bytes, survives cold reopen, binds exact context and uses fresh nonces", () => {
    const f = historyFixture(),
      proof = new HistoryReadProof(f.files),
      seed = { ...cursor(), storeId: f.files.format.storeId };
    const context = { purpose: "search" as const, request: seed },
      payload = randomBytes(6000);
    const token = proof.seal(context, payload, new HistoryReadBudget());
    expect(Buffer.byteLength(token)).toBeLessThanOrEqual(8192);
    expect(token).not.toBe(
      proof.seal(context, payload, new HistoryReadBudget()),
    );
    const cold = new HistoryReadProof(HistoryFiles.open(f.c)!);
    const budget = new HistoryReadBudget();
    expect(cold.open(context, token, budget)).toEqual(payload);
    expect(budget.bytes).toBeGreaterThan(0);
    for (const changed of [
      { ...context, purpose: "detail" as const },
      { ...context, request: { ...seed, query: "other" } },
      { ...context, request: { ...seed, offset: 1 } },
      { ...context, request: { ...seed, snapshotSeq: "2" } },
      {
        ...context,
        request: {
          ...seed,
          scope: { kind: "task" as const, id: randomUUID() },
        },
      },
      { ...context, request: { ...seed, storeId: randomUUID() } },
    ])
      expect(() => cold.open(changed, token, new HistoryReadBudget())).toThrow(
        "corrupt-selected",
      );
    expect(() =>
      proof.seal(context, randomBytes(6001), new HistoryReadBudget()),
    ).toThrow();
    for (const bad of [
      "",
      `${token}=`,
      `${token}!`,
      token.slice(0, -1),
      `rp2.${token.slice(4)}`,
      "a".repeat(8193),
    ])
      expect(() => cold.open(context, bad, new HistoryReadBudget())).toThrow(
        "corrupt-selected",
      );
    for (const offset of [0, 12, 6012]) {
      const packed = Buffer.from(token.slice(4), "base64url");
      packed[offset] ^= 1;
      expect(() =>
        cold.open(
          context,
          `rp1.${packed.toString("base64url")}`,
          new HistoryReadBudget(),
        ),
      ).toThrow("corrupt-selected");
    }
  });
  it("reads unchanged readonly3 proof material without filesystem publication", () => {
    const f = historyFixture(),
      key = join(f.files.directory, "read-proof-key.json"),
      manifest = join(f.files.directory, "format.json");
    if (process.platform !== "win32") {
      chmodSync(key, 0o400);
      chmodSync(manifest, 0o400);
      chmodSync(f.files.directory, 0o500);
    }
    // Pin after the deliberately changed permissions, then require stability.
    const files = HistoryFiles.open(f.c)!,
      beforeKey = readFileSync(key),
      beforeFormat = readFileSync(manifest);
    const beforeKeyStat = lstatSync(key),
      beforeFormatStat = lstatSync(manifest);
    const proof = new HistoryReadProof(files),
      context = {
        purpose: "search" as const,
        request: { ...cursor(), storeId: files.format.storeId },
      };
    const token = proof.seal(
      context,
      Buffer.from("private proof"),
      new HistoryReadBudget(),
    );
    expect(
      new HistoryReadProof(HistoryFiles.open(f.c)!)
        .open(context, token, new HistoryReadBudget())
        .toString(),
    ).toBe("private proof");
    expect(readFileSync(key)).toEqual(beforeKey);
    expect(readFileSync(manifest)).toEqual(beforeFormat);
    expect(lstatSync(key).mtimeMs).toBe(beforeKeyStat.mtimeMs);
    expect(lstatSync(manifest).mtimeMs).toBe(beforeFormatStat.mtimeMs);
  });
  it.each([
    "same-key",
    "different-key",
    "missing-key",
    "linked-key",
    "hardlinked-key",
    "unsafe-key",
    "same-format",
  ])(
    "invalidates warm and cold progress on %s without regeneration",
    (change) => {
      const f = historyFixture(),
        context = {
          purpose: "detail" as const,
          request: { ...cursor(), storeId: f.files.format.storeId },
        },
        proof = new HistoryReadProof(f.files);
      const token = proof.seal(
        context,
        Buffer.from("private checkpoint"),
        new HistoryReadBudget(),
      );
      const path = join(
          f.files.directory,
          change === "same-format" ? "format.json" : "read-proof-key.json",
        ),
        original = readFileSync(path);
      if (change === "hardlinked-key") linkSync(path, `${path}.other`);
      else if (change === "unsafe-key") chmodSync(path, 0o644);
      else {
        renameSync(path, `${path}.preserved`);
        if (change === "linked-key") symlinkSync(`${path}.preserved`, path);
        else if (change !== "missing-key") {
          const bytes =
            change === "different-key"
              ? Buffer.from(
                  JSON.stringify({
                    ...JSON.parse(original.toString()),
                    key: randomBytes(32).toString("base64url"),
                  }),
                )
              : original;
          writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
        }
      }
      if (change === "unsafe-key" && process.platform === "win32") return; // POSIX mode assertion only, not Windows ACL qualification.
      expect(() =>
        proof.open(context, token, new HistoryReadBudget()),
      ).toThrow();
      expect(() =>
        new HistoryReadProof(HistoryFiles.open(f.c)!).open(
          context,
          token,
          new HistoryReadBudget(),
        ),
      ).toThrow();
      expect(() => f.files.assertWritable()).toThrow();
      if (!["same-key", "different-key", "same-format"].includes(change))
        expect(() => HistoryFiles.initialize(f.lease)).toThrow();
      if (change === "missing-key") expect(existsSync(path)).toBe(false);
    },
  );
});

describe("standard portable SHA-256 continuation versus native crypto", () => {
  it("matches known, block/padding, random and full8MiB vectors across serialized splits", () => {
    const vectors = [
      Buffer.alloc(0),
      Buffer.from("abc"),
      Buffer.from("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
      ...[
        1,
        55,
        56,
        63,
        64,
        65,
        119,
        120,
        127,
        128,
        129,
        1023,
        8193,
        LIMITS.segmentBytes,
      ].map((n) => randomBytes(n)),
    ];
    for (const input of vectors) {
      let sha = new ResumableSha256(),
        offset = 0;
      const stride = input.length > 8193 ? 65533 : 17;
      while (offset < input.length) {
        sha.update(input.subarray(offset, offset + stride));
        offset += stride;
        const checkpoint = JSON.parse(JSON.stringify(sha.snapshot()));
        expect(
          Buffer.from(checkpoint.pending, "base64url").length,
        ).toBeLessThan(64);
        sha = new ResumableSha256(checkpoint);
      }
      expect(sha.digest()).toBe(
        createHash("sha256").update(input).digest("hex"),
      );
      expect(sha.digest()).toBe(
        createHash("sha256").update(input).digest("hex"),
      );
    }
    for (let n = 0; n < 32; n++) {
      const input = randomBytes(200 + n * 7),
        at = randomBytes(2).readUInt16BE() % input.length;
      const first = new ResumableSha256().update(input.subarray(0, at));
      expect(
        new ResumableSha256(first.snapshot())
          .update(input.subarray(at))
          .digest(),
      ).toBe(createHash("sha256").update(input).digest("hex"));
    }
  });
  it("rejects impossible, noncanonical and extra checkpoint state", () => {
    const state = new ResumableSha256().snapshot();
    for (const bad of [
      { ...state, schema: "sha256/2" },
      { ...state, bytes: 1 },
      { ...state, bytes: LIMITS.segmentBytes + 1 },
      { ...state, pending: "=" },
      { ...state, words: [0] },
      { ...state, words: state.words.map(() => -1) },
      { ...state, words: state.words.map(() => 0) },
      { ...state, extra: 1 },
    ])
      expect(() => decodeSha256State(bad)).toThrow();
  });
});
