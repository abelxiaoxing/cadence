import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AccessMaterial,
  HttpAuthentication,
  type TokenSource,
} from "../../src/service/auth.ts";
import type { HttpPolicy } from "../../src/service/config.ts";
import {
  type HttpAdapters,
  ServiceHttpServer,
} from "../../src/service/http.ts";
import type { ProjectionPort } from "../../src/service/ports.ts";
import { PrivateFiles } from "../../src/service/private-files.ts";
import {
  ContractError,
  type ExportFrame,
  type ExportRequest,
  encodeExportFrame,
  type LiveEvent,
  type Scope,
  type Snapshot,
} from "../../src/service-contract.ts";
import { browserBuild, sourceBuild } from "./source-build.ts";

export function deferred<T = void>() {
  let resolve!: (v: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
export const coverage = {
  observed: "complete",
  source: "complete",
  redacted: false,
  omissions: [],
} as const;
export function exportFrames(request: ExportRequest): ExportFrame[] {
  const manifest: ExportFrame = {
    exportId: randomUUID(),
    ordinal: 1,
    event: {
      kind: "manifest",
      schema: "cadence-public-export/2",
      request,
      coverage: { ...coverage, omissions: [] },
      serviceProtocol: 1,
      workerProtocol: 2,
      provenance: {
        exporterBuildSha256: "a".repeat(64),
        capturePolicy: "public-text-tools/2",
      },
    },
  };
  const bytes = encodeExportFrame(manifest, request.format);
  return [
    manifest,
    {
      exportId: manifest.exportId,
      ordinal: 2,
      event: {
        kind: "trailer",
        complete: true,
        frames: 1,
        encodedBytes: Buffer.byteLength(bytes),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        committedSeq: request.snapshotSeq,
        coverage: { ...coverage, omissions: [] },
      },
    },
  ];
}
/** Injected task/history state ONLY: real Node HTTP/WS, NOT durable W3 evidence. */
export async function httpFixture(
  policy?: HttpPolicy,
  overrides: Partial<ProjectionPort> = {},
  source: TokenSource = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "cadence-http-"));
  const files = new PrivateFiles(dir);
  AccessMaterial.initialize(files, dir, source);
  const material = new AccessMaterial(files, dir, source);
  const epoch = randomUUID(),
    workspaceId = randomUUID(),
    storeId = randomUUID();
  const local = randomBytes(32).toString("base64url");
  const auth = new HttpAuthentication(material, epoch, workspaceId, local);
  const scope: Scope = { kind: "run", id: randomUUID() };
  let seq = "1";
  const callbacks = new Set<(event: LiveEvent) => void>();
  const snap = (scope: Scope): Snapshot => ({
    protocol: 1,
    storeId,
    epoch,
    scope,
    committedSeq: seq,
    runs: [],
    context: {
      status: "unavailable",
      workspaceId,
      taskId: null,
      error: { code: "unavailable", effect: "none", recovery: "operator" },
    },
    horizon: {
      policy: "active-and-recent",
      historicalRuns: {
        reader: "runs",
        storeId,
        scope,
        snapshotSeq: seq,
        after: null,
        limit: 50,
      },
    },
  });
  const missing = async (): Promise<never> => {
    throw new ContractError("unavailable");
  };
  const projection: ProjectionPort = {
    session: async () => ({
      protocol: 1,
      storeId,
      epoch,
      accessGeneration: material.generation,
      authority: "local",
      csrf: null,
      capabilities: { actions: true, history: true, manualChecks: true },
    }),
    snapshot: async (scope) => snap(scope),
    workspace: missing,
    checkObligations: missing,
    entity: missing,
    tasks: missing,
    runs: missing,
    messages: missing,
    tools: missing,
    contents: missing,
    events: missing,
    checks: missing,
    changes: missing,
    reviews: missing,
    graph: missing,
    detail: missing,
    search: missing,
    validateCursor: async () => ({ status: "valid" }),
    export: async function* (request) {
      yield* exportFrames(request);
    },
    ...overrides,
  };
  const adapters: HttpAdapters = {
    projection,
    admission: null,
    receipts: null,
    live: {
      subscribe: (_scope, callback) => {
        callbacks.add(callback);
        return () => {
          callbacks.delete(callback);
        };
      },
      watermark: (scope) => ({
        kind: "heartbeat",
        storeId,
        epoch,
        scope,
        committedSeq: seq,
      }),
    },
  };
  const server = new ServiceHttpServer({
    build: sourceBuild,
    policy: policy ?? {
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 0,
      proxy: null,
    },
    auth,
    adapters,
    assets: [
      {
        path: "/app",
        bytes: Buffer.from("<h1>Private fixture</h1>"),
        contentType: "text/html; charset=utf-8",
      },
      {
        path: "/assets/main.js",
        bytes: Buffer.from("/* fixed fixture */"),
        contentType: "text/javascript; charset=utf-8",
      },
    ],
  });
  const origin = await server.listen();
  server.admit();
  const token =
    new URL(material.tokenLink(origin)).searchParams.get("token") ?? "";
  const cookie = `${auth.cookieName}=${encodeURIComponent(token)}`;
  return {
    dir,
    files,
    material,
    auth,
    epoch,
    workspaceId,
    storeId,
    local,
    scope,
    projection,
    adapters,
    server,
    origin,
    token,
    cookie,
    snap,
    callbacks,
    setSeq: (value: string) => {
      seq = value;
    },
    emit: (previousSeq: string, committedSeq: string) => {
      seq = committedSeq;
      for (const callback of callbacks)
        callback({
          kind: "update",
          storeId,
          epoch,
          scope,
          previousSeq,
          committedSeq,
          runs: [],
          removed: [],
          context: snap(scope).context,
        });
    },
  };
}
export type Fixture = Awaited<ReturnType<typeof httpFixture>>;
export async function session(f: Fixture, local = false) {
  const response = await request(f.origin, "/api/v1/session", {
    headers: local ? { "x-cadence-local": f.local } : { cookie: f.cookie },
  });
  const value = JSON.parse(response.text).value;
  return {
    response,
    value,
    headers: {
      "x-cadence-build": JSON.stringify(browserBuild),
      ...(local
        ? { "x-cadence-local": f.local }
        : { cookie: f.cookie, origin: f.origin, "x-cadence-csrf": value.csrf }),
      "x-cadence-attachment": String(response.headers["x-cadence-attachment"]),
      "content-type": "application/json",
    },
  };
}
export function request(
  origin: string,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
  } = {},
): Promise<{
  status: number;
  headers: IncomingMessage["headers"];
  text: string;
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      `${origin}${path}`,
      {
        method: options.method ?? "GET",
        headers: options.headers,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}
