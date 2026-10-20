import { renameSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ServiceClient } from "../src/service-client.ts";
import type { ReadCursor } from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import {
  readProjection,
  retainedText,
  searchSeed,
  storedTree,
} from "./helpers/history-read-fixture.ts";
import { httpFixture, request } from "./helpers/service-http-fixture.ts";

it("production issued proof crosses W1 readonlyPOST/client, requires current auth and survives renewed access", async () => {
  const f = historyFixture();
  await retainedText(f, "target".repeat(100));
  renameSync(
    join(f.files.directory, "indexes"),
    join(f.dir, "preserved-indexes"),
  );
  const projection = readProjection(f),
    first = await import("../src/history/search.ts").then((m) =>
      m.searchHistory(projection.reader, searchSeed(f, "target"), 1),
    );
  expect(first.next?.navigation).toBeTruthy();
  const { session: _session, ...reads } = projection;
  const http = await httpFixture(undefined, reads);
  const session = http.projection.session;
  http.projection.session = async () => ({
    ...(await session()),
    storeId: f.files.format.storeId,
  });
  const before = storedTree(f.files.directory),
    methods: string[] = [];
  const transport = () =>
    new HttpServiceTransport({
      origin: http.origin,
      localCapability: http.local,
      fetch: async (url, init) => {
        methods.push(init?.method ?? "GET");
        return fetch(url, init);
      },
    });
  const client = new ServiceClient(transport());
  try {
    expect((await client.session()).kind).toBe("ok");
    const next = await client.search(first.next!);
    expect(next.kind).toBe("ok");
    expect(methods.at(-1)).toBe("POST");
    if (next.kind !== "ok") throw Error("Expected actual proof result");
    expect(next.value.hits.length).toBeGreaterThan(0);
    const cursor: ReadCursor = next.value.next!;
    expect(cursor.navigation).toBeTruthy();
    // Possession of a genuine proof is not cookie/CSRF authority.
    const denied = await request(http.origin, "/api/v1/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cursor),
    });
    expect(denied.status).toBe(401);
    http.material.rotate();
    expect((await client.search(cursor)).kind).toBe("error");
    const renewed = new ServiceClient(transport());
    expect((await renewed.session()).kind).toBe("ok");
    const resumed = await renewed.search(cursor);
    expect(resumed.kind).toBe("ok");
    expect(storedTree(f.files.directory)).toEqual(before);
  } finally {
    await http.server.close();
  }
}, 20000);
