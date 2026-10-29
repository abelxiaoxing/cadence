import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EnvHttpProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from "undici";
import { afterEach, expect, it, vi } from "vitest";
import { NativeConnection } from "../src/native-client.ts";
import { exportNative } from "../src/native-export.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { ServiceClient } from "../src/service-client.ts";
import {
  type ExportRequest,
  encodeExportFrame,
} from "../src/service-contract.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("native owner absence is readonly and never creates task/service state or a fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "native-absent-"));
  vi.stubEnv("XDG_STATE_HOME", join(root, "state"));
  const connection = new NativeConnection();
  await expect(connection.attach(root)).rejects.toThrow();
  await connection.detach();
  expect(existsSync(join(root, "state"))).toBe(false);
  expect(existsSync(join(root, ".cadence"))).toBe(false);
});
it("native local capability never traverses an ambient provider proxy", async () => {
  const f = await acceptingFixture("generated");
  vi.stubEnv("XDG_STATE_HOME", join(f.dir, "state"));
  if (process.platform === "win32")
    vi.stubEnv("LOCALAPPDATA", join(f.dir, "state"));
  let proxyContacts = 0;
  const proxy = createServer((_req, res) => {
    proxyContacts++;
    res.writeHead(502);
    res.end();
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const address = proxy.address();
  if (!address || typeof address === "string") throw Error("fixture");
  const route = `http://127.0.0.1:${address.port}`;
  const previous = getGlobalDispatcher();
  const owned = new EnvHttpProxyAgent({
    httpProxy: route,
    httpsProxy: route,
    noProxy: "",
  });
  const connection = new NativeConnection();
  try {
    // Actual public proxy dispatcher is a fixture prerequisite, never a fetch mock.
    setGlobalDispatcher(owned);
    await connection.attach(f.root);
    expect(connection.session?.authority).toBe("local");
    expect(proxyContacts).toBe(0);
    expect(getGlobalDispatcher()).toBe(owned);
    await connection.detach();
    expect(getGlobalDispatcher()).toBe(owned);
  } finally {
    setGlobalDispatcher(previous); // restore only the test's own temporary replacement
    await connection.detach();
    await owned.close();
    await f.close();
    await new Promise<void>((r) => {
      proxy.close(() => r());
      proxy.closeAllConnections();
    });
  }
}, 20000);
it("native export verifies digest/EOF, refuses overwrites/links and preserves interrupted output", async () => {
  const root = mkdtempSync(join(tmpdir(), "native-export-"));
  const request: ExportRequest = {
    storeId: randomUUID(),
    scope: { kind: "task", id: randomUUID() },
    snapshotSeq: "1",
    format: "ndjson",
  };
  const coverage = {
    observed: "complete",
    source: "complete",
    redacted: false,
    omissions: [],
  } as const;
  const manifest: any = {
    exportId: randomUUID(),
    ordinal: 1,
    event: {
      kind: "manifest",
      schema: "cadence-public-export/2",
      request,
      coverage,
      serviceProtocol: 1,
      workerProtocol: 2,
      provenance: {
        exporterBuildSha256: "1".repeat(64),
        capturePolicy: "public-text-tools/2",
      },
    },
  };
  const encoded = encodeExportFrame(manifest, "ndjson");
  const trailer: any = {
    exportId: manifest.exportId,
    ordinal: 2,
    event: {
      kind: "trailer",
      complete: true,
      frames: 1,
      encodedBytes: Buffer.byteLength(encoded),
      sha256: createHash("sha256").update(encoded).digest("hex"),
      committedSeq: "1",
      coverage,
    },
  };
  for (const variant of [
    "bad-digest",
    "missing-trailer",
    "post-trailer-failure",
  ]) {
    const transport: any = {
      async *export() {
        yield manifest;
        if (variant !== "missing-trailer")
          yield variant === "bad-digest"
            ? {
                ...trailer,
                event: { ...trailer.event, sha256: "0".repeat(64) },
              }
            : trailer;
        if (variant === "post-trailer-failure")
          throw Error("lost original EOF");
      },
    };
    const path = join(root, variant);
    await expect(
      exportNative(
        new ServiceClient(transport),
        request,
        path,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(readFileSync(path, "utf8")).toBe(encoded);
  }
  writeFileSync(join(root, "existing"), "preserve");
  symlinkSync(join(root, "existing"), join(root, "linked"));
  const client = new ServiceClient({
    async *export() {
      yield manifest;
      yield trailer;
    },
  } as any);
  await expect(
    exportNative(
      client,
      request,
      join(root, "linked"),
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(readFileSync(join(root, "existing"), "utf8")).toBe("preserve");

  // Deterministic deadline injection, not a real ten-second network wait. Finite
  // native requests stay bounded; an actively progressing export has no total
  // ten-second ceiling and still needs its original trailer/EOF.
  const epoch = randomUUID();
  vi.spyOn(ServiceCoordination.prototype, "localAccess").mockReturnValue({
    endpoint: "http://127.0.0.1:17423",
    epoch,
    capability: "a".repeat(43),
  });
  const deadlines: AbortController[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    expect(milliseconds).toBe(10000);
    const controller = new AbortController();
    deadlines.push(controller);
    return controller.signal;
  });
  let exportSignal: AbortSignal | null | undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).endsWith("/session"))
      return Response.json(
        {
          kind: "ok",
          value: {
            protocol: 1,
            storeId: request.storeId,
            epoch,
            accessGeneration: 1,
            authority: "local",
            csrf: null,
            capabilities: {
              actions: false,
              manualChecks: false,
              history: true,
            },
          },
        },
        { headers: { "x-cadence-attachment": randomUUID() } },
      );
    if (String(url).endsWith("/detach"))
      return Response.json({ kind: "ok", value: null });
    expect(new URL(String(url)).pathname).toBe("/api/v1/export");
    exportSignal = init?.signal;
    let first = true;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (first) {
            first = false;
            controller.enqueue(Buffer.from(encoded));
            return;
          }
          // Model the original native fetch deadline firing while bytes flow.
          for (const deadline of deadlines) deadline.abort();
          if (exportSignal?.aborted)
            controller.error(new Error("total deadline"));
          else {
            controller.enqueue(
              Buffer.from(encodeExportFrame(trailer, "ndjson")),
            );
            controller.close();
          }
        },
      }),
    );
  });
  const connection = new NativeConnection();
  try {
    const native = await connection.attach(root);
    expect(deadlines).toHaveLength(1);
    deadlines.length = 0;
    const caller = new AbortController();
    const destination = join(root, " 汉🧪 complete export ");
    await expect(
      exportNative(native, request, destination, caller.signal),
    ).resolves.toBe("complete");
    expect(exportSignal?.aborted).toBe(false);
    expect(readFileSync(destination, "utf8")).toBe(
      encoded + encodeExportFrame(trailer, "ndjson"),
    );
  } finally {
    await connection.detach();
  }
});
