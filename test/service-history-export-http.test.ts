import { createHash } from "node:crypto";
import { ServerResponse } from "node:http";
import { expect, it, vi } from "vitest";
import { HistoryFiles } from "../src/history/files.ts";
import { ServiceClient } from "../src/service-client.ts";
import {
  type ExportFrame,
  type ExportRequest,
  ExportTracker,
  encodeExportFrame,
  LIMITS,
} from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { wireUrl } from "../src/service-wire.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import {
  readProjection,
  retainedText,
  searchSeed,
  storedTree,
} from "./helpers/history-read-fixture.ts";
import {
  deferred,
  httpFixture,
  request,
} from "./helpers/service-http-fixture.ts";

async function setup() {
  const f = historyFixture();
  await retainedText(f, `${"HTTP retained 😀\n".repeat(20000)}http-last-hit`);
  const projection = readProjection(f);
  const { session: _session, ...reads } = projection;
  const http = await httpFixture(undefined, reads);
  const session = http.projection.session;
  http.projection.session = async () => ({
    ...(await session()),
    storeId: f.files.format.storeId,
  });
  const input: ExportRequest = {
    storeId: f.files.format.storeId,
    scope: { kind: "task", id: f.link.taskId },
    snapshotSeq: f.writer.committedSeq,
    format: "ndjson",
  };
  const client = new ServiceClient(
    new HttpServiceTransport({
      origin: http.origin,
      localCapability: http.local,
    }),
  );
  return { f, projection, http, input, client };
}
it("real W1 cookie/header search, exact detail, typed /export and both /download formats use real retained history", async () => {
  const { f, http, input, client } = await setup(),
    before = storedTree(f.files.directory);
  try {
    expect((await client.session()).kind).toBe("ok");
    let cursor = searchSeed(f, "http-last-hit");
    const hits = [];
    for (let n = 0; n < 1000; n++) {
      const searched = await client.search(cursor);
      expect(searched.kind).toBe("ok");
      if (searched.kind !== "ok") throw Error("Reader refused");
      hits.push(...searched.value.hits);
      if (!searched.value.next) break;
      cursor = searched.value.next;
    }
    expect(hits).toHaveLength(1);
    expect((await client.detail(hits[0].cursor)).kind).toBe("ok");
    for (const format of ["ndjson", "markdown"] as const) {
      const selected = { ...input, format },
        tracker = new ExportTracker(selected),
        hash = createHash("sha256");
      let trailer = false;
      for await (const frame of client.export(
        selected,
        new AbortController().signal,
      )) {
        tracker.receive(frame);
        if (frame.event.kind === "trailer") {
          expect(frame.event.sha256).toBe(hash.digest("hex"));
          trailer = true;
        } else hash.update(encodeExportFrame(frame, format));
      }
      expect(trailer).toBe(true);
      const downloaded = await request(
        http.origin,
        wireUrl("download", selected),
        { headers: { cookie: http.cookie } },
      );
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers["cache-control"]).toBe("no-store");
      expect(downloaded.headers["content-disposition"]).toContain("attachment");
      expect(downloaded.text).toContain("http-last-hit");
      expect(downloaded.text).toContain('"kind":"trailer"');
      expect(downloaded.headers["content-type"]).toContain(
        format === "markdown" ? "text/markdown" : "application/x-ndjson",
      );
    }
    expect(
      (await request(http.origin, wireUrl("download", input))).status,
    ).toBe(401);
    expect(storedTree(f.files.directory)).toEqual(before);
  } finally {
    await http.server.close();
  }
}, 20000);
it.each(["missing", "trailing", "digest", "malformed"])(
  "real retained export with injected %s adapter fault never passes W1 digest/EOF or client tracker",
  async (fault) => {
    const { http, input, client, projection } = await setup();
    http.projection.export = async function* (request, signal) {
      for await (const frame of projection.export(request, signal)) {
        if (frame.event.kind === "trailer") {
          if (fault === "missing") return;
          if (fault === "digest") frame.event.sha256 = "0".repeat(64);
          if (fault === "malformed") frame.ordinal++;
          yield frame;
          if (fault === "trailing") yield frame;
        } else yield frame;
      }
    };
    const seen: string[] = [];
    try {
      await expect(
        (async () => {
          for await (const frame of client.export(
            input,
            new AbortController().signal,
          ))
            seen.push(frame.event.kind);
        })(),
      ).rejects.toThrow();
      expect(seen).toContain("detail");
      expect(seen).not.toContain("trailer");
    } finally {
      await http.server.close();
    }
  },
  15000,
);
it("rotation inside the real response-write callback stops the original reader before another payload/trailer", async () => {
  const { http, input, client } = await setup(),
    seen: string[] = [];
  const original = ServerResponse.prototype.write,
    reads = vi.spyOn(HistoryFiles.prototype, "readArtifact");
  let rotated = false;
  // Controlled timing at a REAL Node response write; not a fabricated auth or
  // digest adapter. Rotation invalidates W1's captured generation immediately.
  const write = vi
    .spyOn(ServerResponse.prototype, "write")
    .mockImplementation(function (
      this: ServerResponse,
      ...args: Parameters<ServerResponse["write"]>
    ) {
      const callback = args.at(-1);
      if (
        !rotated &&
        typeof callback === "function" &&
        String(this.getHeader("content-type")).includes("ndjson")
      ) {
        args[args.length - 1] = ((error?: Error | null) => {
          if (!rotated) {
            rotated = true;
            http.material.rotate();
          }
          callback(error);
        }) as never;
      }
      return Reflect.apply(original, this, args);
    });
  try {
    await expect(
      (async () => {
        for await (const frame of client.export(
          input,
          new AbortController().signal,
        ))
          seen.push(frame.event.kind);
      })(),
    ).rejects.toThrow();
    expect(rotated).toBe(true);
    expect(seen).not.toContain("trailer");
    expect(reads).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
    reads.mockRestore();
    await http.server.close();
  }
});
it("two canceled exports keep slots until original gated reads settle; no replacement trailer or history writes", async () => {
  const { f, http, input, projection } = await setup(),
    release = deferred(),
    before = storedTree(f.files.directory);
  let entered = 0,
    settled = 0;
  http.projection.export = async function* (request, signal) {
    const original = projection.export(request, signal)[Symbol.asyncIterator]();
    try {
      const first = await original.next();
      if (!first.done) yield first.value;
      entered++;
      await release.promise;
      for (;;) {
        const next = await original.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      settled++;
      await original.return?.();
    }
  };
  const a = new AbortController(),
    b = new AbortController();
  try {
    const first = await fetch(`${http.origin}${wireUrl("export", input)}`, {
      headers: { cookie: http.cookie },
      signal: a.signal,
    });
    const second = await fetch(`${http.origin}${wireUrl("export", input)}`, {
      headers: { cookie: http.cookie },
      signal: b.signal,
    });
    await vi.waitFor(() => expect(entered).toBe(2));
    a.abort();
    b.abort();
    await first.body?.cancel().catch(() => {});
    await second.body?.cancel().catch(() => {});
    expect(
      (
        await request(http.origin, wireUrl("export", input), {
          headers: { cookie: http.cookie },
        })
      ).status,
    ).toBe(429);
    expect(settled).toBe(0);
    release.resolve();
    await vi.waitFor(() => expect(settled).toBe(2));
    expect(storedTree(f.files.directory)).toEqual(before);
  } finally {
    release.resolve();
    await http.server.close();
  }
});
it("configured 120s idle expiration aborts a gated original export but does not refund its slot early (injected timer firing)", async () => {
  const { http, input, projection } = await setup(),
    release = deferred();
  let idle: (() => void) | undefined,
    entered = false,
    settled = false;
  const original = setTimeout;
  const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    if (ms === LIMITS.downloadIdleMs) idle = callback;
    return Reflect.apply(original, globalThis, [callback, ms, ...args]);
  }) as typeof setTimeout);
  http.projection.export = async function* (request, signal) {
    try {
      for await (const frame of projection.export(request, signal)) {
        yield frame;
        if (frame.event.kind === "manifest") {
          entered = true;
          await release.promise;
        }
      }
    } finally {
      settled = true;
    }
  };
  const client = new ServiceClient(
      new HttpServiceTransport({
        origin: http.origin,
        localCapability: http.local,
      }),
    ),
    seen: ExportFrame[] = [];
  const pending = (async () => {
    for await (const frame of client.export(
      input,
      new AbortController().signal,
    ))
      seen.push(frame);
  })();
  const rejected = expect(pending).rejects.toThrow();
  try {
    await vi.waitFor(() => expect(entered && !!idle).toBe(true));
    idle?.();
    await rejected;
    expect(settled).toBe(false);
    expect(seen.some((f) => f.event.kind === "trailer")).toBe(false);
    release.resolve();
    await vi.waitFor(() => expect(settled).toBe(true));
  } finally {
    release.resolve();
    timer.mockRestore();
    await http.server.close();
  }
});
it("two aborted searches retain original validation slots until settlement and do not enter another source read", async () => {
  const { f, http, projection } = await setup(),
    release = deferred();
  let entered = 0;
  const search = vi.fn(projection.search);
  http.projection.search = search;
  http.projection.validateCursor = async (cursor) => {
    entered++;
    await release.promise;
    return projection.validateCursor(cursor);
  };
  const url = `${http.origin}${wireUrl("search", searchSeed(f, "http-last-hit"))}`,
    a = new AbortController(),
    b = new AbortController();
  const first = fetch(url, {
      headers: { cookie: http.cookie },
      signal: a.signal,
    }).catch(() => null),
    second = fetch(url, {
      headers: { cookie: http.cookie },
      signal: b.signal,
    }).catch(() => null);
  try {
    await vi.waitFor(() => expect(entered).toBe(2));
    a.abort();
    b.abort();
    await Promise.all([first, second]);
    expect(
      (
        await request(
          http.origin,
          wireUrl("search", searchSeed(f, "http-last-hit")),
          { headers: { cookie: http.cookie } },
        )
      ).status,
    ).toBe(429);
    expect(search).not.toHaveBeenCalled();
    release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(search).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await http.server.close();
  }
});
