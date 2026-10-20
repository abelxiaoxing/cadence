import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import {
  decodeDetailReadResult,
  decodeEntityReadResult,
  decodeExportFrame,
  decodeGraphReadResult,
  decodeHistoryReadResult,
  decodeSearchPage,
  type Graph,
  LIMITS,
} from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { decodeHttpOutput, type HttpOperation } from "../src/service-wire.ts";

const id = randomUUID(),
  coverage = {
    observed: "complete",
    source: "complete",
    redacted: false,
    omissions: [],
  },
  scope = { kind: "task", id },
  content = {
    recordId: id,
    version: 1,
    field: "plan",
    bytes: 0,
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  },
  cursor = {
    storeId: id,
    scope,
    snapshotSeq: "1",
    query: null,
    recordId: id,
    recordVersion: 1,
    field: "plan",
    offset: 0,
  },
  request = {
    storeId: id,
    scope,
    snapshotSeq: "1",
    reader: "events",
    after: null,
    limit: 50,
  },
  entity = {
    storeId: id,
    scope,
    snapshotSeq: "1",
    kind: "task",
    id,
    version: 1,
  },
  graphRequest = {
    storeId: id,
    scope,
    snapshotSeq: "1",
    graph: { recordId: id, revision: 1, sha256: "a".repeat(64) },
  },
  graph: Graph = {
    schema: "cadence-graph/2",
    taskId: id,
    taskKind: "research",
    taskRevision: 1,
    revision: 1,
    planRevision: 1,
    plan: { ...content, field: "plan" },
    assignments: [
      {
        id: "one",
        purpose: "research",
        instructions: "Inspect",
        expectedOutput: "Findings",
        role: { role: "design-explorer", sha256: "a".repeat(64) },
        model: {
          provider: "fixture",
          model: "fixture",
          api: "openai-completions",
          thinking: "off",
          sourceSelectionId: id,
        },
        dependencies: [],
      },
    ],
  };

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const detail = { cursor, content, range: null, text: "", next: null, coverage };
const task = {
  kind: "task",
  owner: {
    taskId: id,
    runId: null,
    childRunId: null,
    entity: { kind: "task", id, version: 1 },
  },
  version: 1,
  goal: "Inspect",
  plan: null,
};
const progress = (request: object) => ({
  kind: "progress",
  request,
  next: { ...request, navigation: "a" },
  coverage,
});
const detailProgress = {
  kind: "progress",
  cursor,
  next: { ...cursor, navigation: "a" },
  coverage,
};
const vectors: {
  name: string;
  decode: (value: unknown) => unknown;
  value: object;
}[] = [
  { name: "detail data", decode: decodeDetailReadResult, value: detail },
  {
    name: "detail progress",
    decode: decodeDetailReadResult,
    value: detailProgress,
  },
  {
    name: "search",
    decode: decodeSearchPage,
    value: {
      cursor: {
        ...cursor,
        query: "x",
        recordId: null,
        recordVersion: null,
        field: null,
      },
      hits: [],
      next: null,
      coverage,
    },
  },
  {
    name: "collection data",
    decode: decodeHistoryReadResult,
    value: { request, records: [], next: null, coverage },
  },
  {
    name: "collection progress",
    decode: decodeHistoryReadResult,
    value: progress(request),
  },
  {
    name: "snapshot transition",
    decode: decodeHistoryReadResult,
    value: {
      kind: "snapshot",
      request: { ...request, snapshotSeq: null },
      next: { ...request, navigation: "a" },
      coverage,
    },
  },
  {
    name: "entity data",
    decode: decodeEntityReadResult,
    value: { request: entity, record: task },
  },
  {
    name: "entity progress",
    decode: decodeEntityReadResult,
    value: progress(entity),
  },
  {
    name: "graph progress",
    decode: decodeGraphReadResult,
    value: progress(graphRequest),
  },
];

it.each(vectors)(
  "$name counts the success wrapper at the encoded page boundary using structurally valid DTOs",
  ({ decode, value }) => {
    // Portable size vectors, not committed snapshots: the decimal sequence has no
    // smaller portable limit. All correlations/fields remain valid as it grows.
    const seed = JSON.stringify(value),
      count = seed.split('"snapshotSeq":"1"').length - 1;
    const withDigits = (n: number) =>
      JSON.parse(
        seed.replaceAll(
          '"snapshotSeq":"1"',
          `"snapshotSeq":"${"1".repeat(n)}"`,
        ),
      );
    const n =
      1 + Math.floor((LIMITS.pageBytes - bytes({ kind: "ok", value })) / count);
    const at = withDigits(n),
      over = withDigits(n + 1);
    expect(decode(at)).toEqual(at);
    expect(bytes({ kind: "ok", value: at })).toBeLessThanOrEqual(
      LIMITS.pageBytes,
    );
    expect(bytes({ kind: "ok", value: at })).toBeGreaterThan(
      LIMITS.pageBytes - count,
    );
    expect(bytes(over)).toBeLessThanOrEqual(LIMITS.pageBytes); // old value-only accounting admitted this
    expect(() => decode(over)).toThrow(
      expect.objectContaining({ code: "oversize" }),
    );
    expect(() => decode({ ...value, extra: null })).toThrow(
      expect.objectContaining({ code: "invalid" }),
    );
  },
);

it("standalone graph and typed graph export independently enforce their existing 1MiB envelopes", () => {
  const page = { request: graphRequest, graph },
    wrapped = { kind: "ok", value: page },
    frame = { exportId: id, ordinal: 1, event: { kind: "graph", graph: page } };
  for (const [input, decode] of [
    [wrapped, (v: unknown) => decodeHttpOutput("graph", v)],
    [frame, decodeExportFrame],
  ] as const) {
    const seed = JSON.stringify(input);
    const fill = (size: number) =>
      JSON.parse(
        seed.replace(
          '"snapshotSeq":"1"',
          `"snapshotSeq":"${"1".repeat(1 + size - bytes(input))}"`,
        ),
      );
    const at = fill(LIMITS.controlBytes);
    expect(bytes(at)).toBe(LIMITS.controlBytes);
    expect(decode(at)).toEqual(at);
    expect(() => decode(fill(LIMITS.controlBytes + 1))).toThrow(
      expect.objectContaining({ code: "oversize" }),
    );
  }
});

it("real HTTP page/progress wire bytes cannot bypass 512KiB via JSON whitespace normalization", async () => {
  const cases: { operation: HttpOperation; input: unknown; value: unknown }[] =
    [
      { operation: "detail", input: cursor, value: detail },
      { operation: "detail", input: cursor, value: detailProgress },
      {
        operation: "search",
        input: {
          ...cursor,
          query: "x",
          recordId: null,
          recordVersion: null,
          field: null,
        },
        value: vectors[2].value,
      },
      ...(
        [
          "tasks",
          "runs",
          "messages",
          "tools",
          "contents",
          "events",
          "checks",
          "changes",
          "reviews",
        ] as const
      ).flatMap((reader) => {
        const selected = {
          ...request,
          reader,
          scope: reader === "tasks" ? { kind: "workspace", id } : scope,
        };
        return [
          {
            operation: reader,
            input: selected,
            value: { request: selected, records: [], next: null, coverage },
          },
          { operation: reader, input: selected, value: progress(selected) },
          {
            operation: reader,
            input: { ...selected, snapshotSeq: null },
            value: {
              kind: "snapshot",
              request: { ...selected, snapshotSeq: null },
              next: { ...selected, navigation: "a" },
              coverage,
            },
          },
        ];
      }),
      {
        operation: "entity",
        input: entity,
        value: { request: entity, record: task },
      },
      { operation: "entity", input: entity, value: progress(entity) },
      {
        operation: "graph",
        input: graphRequest,
        value: progress(graphRequest),
      },
    ];
  let output = "";
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(output);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No native address");
  const transport = new HttpServiceTransport({
    origin: `http://127.0.0.1:${address.port}`,
  });
  try {
    for (const c of cases) {
      const reply = { kind: "ok", value: c.value },
        text = JSON.stringify(reply);
      expect(decodeHttpOutput(c.operation, reply)).toEqual(reply);
      // Use the public named method, not a mock fetch or private request bypass.
      const call = () =>
        Reflect.apply(
          transport[c.operation as keyof HttpServiceTransport] as (
            ...args: unknown[]
          ) => Promise<unknown>,
          transport,
          [c.input],
        );
      output = text + " ".repeat(LIMITS.pageBytes - Buffer.byteLength(text));
      expect(await call()).toEqual(reply);
      output += " ";
      await expect(call(), `${c.operation} wire size`).rejects.toThrow(
        expect.objectContaining({ code: "oversize" }),
      );
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 20000);
