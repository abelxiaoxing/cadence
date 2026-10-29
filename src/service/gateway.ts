/** One authenticated UI origin, no default project, no SDK/runtime on discovery.
 * Project traffic remains browser-authority traffic on the real owner; the gateway
 * never turns a browser command into a native-capability action. */
import { randomUUID } from "node:crypto";
import { opendirSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  request,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { homedir } from "node:os";
import { WebSocket, WebSocketServer } from "ws";
import { loadWebAssets } from "../service-assets.ts";
import {
  ContractError,
  canonicalJson,
  compatibleBuild,
  decodeClientBuild,
  LIMITS,
  parseWireJson,
  publicError,
} from "../service-contract.ts";
import { assertRequestTarget, readRoute, WS_PATH } from "../service-wire.ts";
import { effectiveWorkspace } from "../task-store.ts";
import { HttpAuthentication, requestBoundary } from "./auth.ts";
import {
  nativeCall,
  openProjectDirectory,
  ProjectOpenRefusal,
  serviceStatus,
  stopService,
} from "./cli.ts";
import { localOrigin } from "./config.ts";
import { closed, decodeHash, decodeId, text } from "./contracts/core.ts";
import { decodeProjectEntry } from "./contracts/gateway.ts";
import { decodeWorkbenchCommand } from "./contracts/workbench.ts";
import { ServiceCoordination } from "./coordination.ts";
import {
  decodeGatewayInput,
  type GatewayInput,
  type GatewayProject,
  GatewayStore,
} from "./gateway-store.ts";
import { fixedHeaders } from "./http.ts";
import { encoded, hash, json } from "./private-files.ts";
import { readHostConfig } from "./runtime.ts";
import { readServerConfig } from "./server-config.ts";
import { WorkbenchFiles } from "./workbench-files.ts";

declare const __CADENCE_SERVICE_CONTRACT__: string;
interface Binding {
  project: GatewayProject;
  endpoint: string;
  cookie: string;
}
/** Serial owner settlement avoids racing their shared registry writer. */
export async function joinProjectStops(
  projects: readonly GatewayProject[],
  stopProject: (project: GatewayProject) => Promise<void>,
): Promise<void> {
  let uncertain = false;
  for (const project of projects) {
    try {
      await stopProject(project);
    } catch {
      // One changed/unknown owner must not prevent Stop reaching the others.
      // Do not signal a changed epoch or upgrade an unconfirmed result.
      uncertain = true;
    }
  }
  if (uncertain) throw new ContractError("quarantine");
}
export async function createGateway(
  value: GatewayInput,
  hostUrl: URL,
  source?: { contractHash: string; webDirectory?: string },
) {
  const input = decodeGatewayInput(value),
    store = new GatewayStore(input.serverConfig, input.stateHome);
  const web = loadWebAssets(source?.webDirectory);
  const build = {
    contractHash:
      typeof __CADENCE_SERVICE_CONTRACT__ === "undefined"
        ? (source?.contractHash as string)
        : __CADENCE_SERVICE_CONTRACT__,
    assets: {
      sourceHash: web.manifest.sourceHash,
      contractHash: web.manifest.contractHash,
      buildId: web.manifest.buildId,
    },
  };
  const configured = readServerConfig(input.serverConfig).config;
  if (configured.port !== input.policy.port)
    throw new ContractError("conflict");
  const assets = new Map(web.assets.map((asset) => [asset.path, asset]));
  const connections = new Set<Socket>(),
    relays = new Set<() => void>();
  const opens = new Map<
    string,
    { identity: string; result: Promise<GatewayProject> }
  >();
  const retirements = new Set<Promise<void>>();
  const attachments = new Map<string, string>();
  const bindings = new Map<string, Promise<Binding>>();
  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    maxPayload: LIMITS.wsClientFrameBytes,
  });
  let accepting = false,
    stopping: Promise<void> | undefined;
  let auth: HttpAuthentication;
  let pending = 0;
  let opening = false;
  const server = createServer(
    {
      maxHeaderSize: LIMITS.headerBytes,
      headersTimeout: 10000,
      requestTimeout: 30000,
      keepAliveTimeout: 5000,
    },
    (req, res) => {
      void handle(req, res);
    },
  );
  server.maxConnections = 64;
  server.on("connection", (socket) => {
    connections.add(socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => connections.delete(socket));
  });
  server.on("clientError", (_error, socket) =>
    socket.end(
      "HTTP/1.1 400 Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    ),
  );
  server.on("checkContinue", (_req, res) =>
    reply(res, 400, { kind: "error", error: publicError("invalid") }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.policy.port, input.policy.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new ContractError("unavailable");
  const endpoint = localOrigin(input.policy, address.port);
  let acquired: ReturnType<GatewayStore["acquire"]>;
  try {
    acquired = store.acquire(endpoint, configured.token, input);
    auth = new HttpAuthentication(
      acquired.access,
      acquired.registration.epoch,
      acquired.registration.id,
      acquired.registration.capability,
    );
    acquired.access.onRevoke(() => {
      for (const close of relays) close();
      bindings.clear();
      const grouped = new Map<string, string[]>();
      for (const [id, project] of attachments)
        grouped.set(project, [...(grouped.get(project) ?? []), id]);
      attachments.clear();
      const original = (async () => {
        for (const [id, ids] of grouped) {
          const project = store.projects().find((p) => p.id === id);
          if (!project) throw new ContractError("unavailable");
          const c = new ServiceCoordination(project.path, input.stateHome);
          if (c.inspect().status === "stopped") continue;
          if (c.localAccess().epoch !== project.epoch)
            throw new ContractError("stale");
          for (let offset = 0; offset < ids.length; offset += LIMITS.viewers) {
            const result = closed(
              await nativeCall(c, "detach-viewers", false, {
                attachments: ids.slice(offset, offset + LIMITS.viewers),
              }),
              ["status", "epoch"],
            );
            if (result.status !== "detached" || result.epoch !== project.epoch)
              throw new ContractError("unavailable");
          }
        }
      })();
      retirements.add(original);
      // Retain a failed retirement until Stop, rather than pretending grants or
      // attachment charges were released. No action/SDK cancellation here.
      void original.then(
        () => retirements.delete(original),
        () => {},
      );
    });
    accepting = true;
  } catch (error) {
    server.close();
    throw error;
  }
  const files = new WorkbenchFiles(
    homedir(),
    [store.files.namespace, input.agentDir],
    () => acquired.access.redactionLiterals(),
  );
  const assert = () => {
    store.assert();
    if (!accepting) throw new ContractError("quarantine");
  };
  async function open(
    path: string,
    id: string,
    epoch: string,
  ): Promise<GatewayProject> {
    assert();
    if (epoch !== auth.epoch) throw new ContractError("stale");
    const identity = canonicalJson({ path, epoch }),
      previous = opens.get(id);
    if (previous) {
      if (previous.identity !== identity) throw new ContractError("conflict");
      return previous.result;
    }
    const intentPath = store.path(`commands/${id}.json`),
      kept = store.files.read(intentPath);
    if (kept) {
      if (kept.bytes.toString("utf8") !== identity)
        throw new ContractError("conflict");
      const settled = store.files.read(
        store.path(`commands/${id}.result.json`),
      );
      if (!settled) throw new ContractError("receipt-inconclusive");
      return decodeProjectEntry(json(settled));
    }
    if (opening) throw new ContractError("capacity");
    if (opens.size >= 128 || store.projects().length >= 128)
      throw new ContractError("capacity");
    const commands = store.path("commands");
    if (store.files.directory(commands)) {
      const dir = opendirSync(commands);
      let count = 0;
      try {
        while (dir.readSync())
          if (++count >= 2048) throw new ContractError("capacity");
      } finally {
        dir.closeSync();
      }
    }
    const directory = files.directory(path);
    effectiveWorkspace(directory, input.stateHome);
    store.files.create(intentPath, identity);
    // Register the original before the launch microtask; browser departure never
    // cancels this accepted operation, and Stop waits its safety publications.
    opening = true;
    const result = Promise.resolve().then(async () => {
      const opened = await openProjectDirectory(
        directory,
        input.stateHome,
        input.agentDir,
        hostUrl,
      );
      const c = new ServiceCoordination(opened.path, input.stateHome),
        access = c.localAccess();
      const project = {
        id: hash(c.store.root),
        path: c.store.root,
        cwd: readHostConfig(c)?.cwd ?? directory,
        epoch: access.epoch,
      };
      store.saveProject(project);
      bindings.delete(project.id);
      store.files.create(
        store.path(`commands/${id}.result.json`),
        encoded(project),
      );
      return project;
    });
    opens.set(id, { identity, result });
    void result.then(
      () => {
        opens.delete(id);
        opening = false;
      },
      () => {
        opening = false;
      },
    );
    return result;
  }
  function binding(id: string): Promise<Binding> {
    const project = store.associatedProjects().find((p) => p.id === id);
    if (!project) throw new ContractError("unavailable");
    const c = new ServiceCoordination(project.path, input.stateHome),
      local = c.localAccess();
    if (c.store.root !== project.path || local.epoch !== project.epoch)
      throw new ContractError("stale");
    const previous = bindings.get(id);
    if (previous) return previous;
    const result = (async () => {
      const raw = closed(await nativeCall(c, "token-link", true), ["link"]),
        link = new URL(text(raw.link, 4096, true));
      // The local capability authenticates only this server-side bootstrap. It
      // is NEVER used to forward browser traffic or returned to the browser.
      const secret = link.searchParams.get("token");
      if (!secret) throw new ContractError("unavailable");
      const cookie = await new Promise<string>((resolve, reject) => {
        const req = request(
          `${local.endpoint}/?token=${encodeURIComponent(secret)}`,
          { agent: false },
          (res) => {
            const cookie = res.headers["set-cookie"];
            res.resume();
            if (res.statusCode !== 303 || cookie?.length !== 1)
              reject(new ContractError("unavailable"));
            else resolve(cookie[0].split(";")[0]);
          },
        );
        req.setTimeout(2000, () => req.destroy(new Error()));
        req.on("error", () => reject(new ContractError("unavailable")));
        req.end();
      });
      if (c.localAccess().epoch !== project.epoch)
        throw new ContractError("stale");
      return { project, endpoint: local.endpoint, cookie };
    })();
    bindings.set(id, result);
    return result;
  }
  function stop(): void {
    if (stopping) return;
    accepting = false;
    store.phase("stopping");
    stopping = (async () => {
      const originals = await Promise.allSettled(
        [...opens.values()].map((o) => o.result),
      );
      // An unconfirmed launch may have its own owner. Retain its fence, but
      // still stop every independently known associated owner below.
      const uncertainOpening = originals.some(
        (r) =>
          r.status === "rejected" &&
          !(r.reason instanceof ProjectOpenRefusal && r.reason.noOwner),
      );
      const retired = await Promise.allSettled([...retirements]);
      const targets = store.associatedProjects();
      // Owners share the short registry writer. Do not race their final release
      // by issuing simultaneous Stop requests from this workbench.
      await joinProjectStops(targets, async (p) => {
        const c = new ServiceCoordination(p.path, input.stateHome),
          observed = await serviceStatus(c);
        const status =
          observed && typeof observed === "object" && "status" in observed
            ? observed.status
            : "unavailable";
        if (status === "stopped") {
          if (
            !(
              observed &&
              typeof observed === "object" &&
              "epoch" in observed &&
              observed.epoch === p.epoch
            )
          )
            throw new ContractError("stale");
          return;
        }
        if (status !== "alive" || c.localAccess().epoch !== p.epoch)
          throw new ContractError("quarantine");
        if ((await stopService(c)).status !== "stopped")
          throw new ContractError("quarantine");
      });
      if (uncertainOpening || retired.some((r) => r.status === "rejected"))
        throw new ContractError("quarantine");
      store.release();
      for (const close of relays) close();
      wss.close();
      server.close();
      for (const socket of connections) socket.end();
    })().catch(() => {
      try {
        store.phase("quarantined");
      } catch {
        /* uncertain state remains */
      }
    });
  }
  async function body(req: IncomingMessage, maximum = 16384): Promise<unknown> {
    if (
      req.headers["content-type"] !== "application/json" ||
      req.headers["content-encoding"] ||
      req.headers["transfer-encoding"]
    )
      throw new ContractError("invalid");
    const chunks: Buffer[] = [];
    let count = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      count += chunk.length;
      if (count > maximum) throw new ContractError("oversize");
      chunks.push(chunk);
    }
    return parseWireJson(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      maximum,
    );
  }
  function reply(res: ServerResponse, code: number, value: unknown) {
    if (res.destroyed || res.writableEnded) return;
    fixedHeaders(res);
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(canonicalJson(value));
  }
  function target(raw: string): { id: string; tail: string } | null {
    const match = /^\/projects\/([a-f0-9]{64})(\/.*)$/.exec(raw);
    return match ? { id: decodeHash(match[1]), tail: match[2] } : null;
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    let effect = false;
    if (++pending > 64) {
      pending--;
      reply(res, 429, { kind: "error", error: publicError("capacity") });
      return;
    }
    fixedHeaders(res);
    try {
      const boundary = requestBoundary(req, input.policy, endpoint),
        raw = req.url ?? "";
      assertRequestTarget(raw);
      const url = new URL(raw, endpoint);
      if (raw === "/healthz" && req.method === "GET") {
        reply(res, 200, { status: "ok" });
        return;
      }
      store.assert();
      if (url.searchParams.has("token")) {
        if (
          req.method !== "GET" ||
          !raw.startsWith("/?token=") ||
          [...url.searchParams.keys()].length !== 1
        )
          throw new ContractError("invalid");
        res.setHeader(
          "Set-Cookie",
          auth.bootstrap(url.searchParams.get("token") ?? "", boundary),
        );
        res.statusCode = 303;
        res.setHeader("Location", "/app");
        res.end();
        return;
      }
      if (raw === "/" && req.method === "GET") {
        res.end(
          "Cadence workbench: open the private link. No default workspace is created.\n",
        );
        return;
      }
      if (raw.startsWith("/local/v1/admin/")) {
        const caller = auth.authenticate(
          boundary,
          randomUUID(),
          req.method === "POST",
        );
        if (caller.authority !== "local") throw new ContractError("forbidden");
        const operation = raw.slice("/local/v1/admin/".length);
        if (
          ["status", "diagnose"].includes(operation) &&
          req.method === "GET"
        ) {
          reply(res, 200, {
            kind: "ok",
            value: {
              ...store.inspect(),
              projects: store.projects().length,
            },
          });
          return;
        }
        if (req.method !== "POST") throw new ContractError("invalid");
        const value = await body(req);
        if (operation === "token-link") {
          const o = closed(value, ["reveal"]);
          if (o.reveal !== true) throw new ContractError("forbidden");
          reply(res, 200, {
            kind: "ok",
            value: {
              link: acquired.access.tokenLink(
                input.policy.proxy?.origin ?? endpoint,
              ),
            },
          });
          return;
        }
        closed(value, []);
        if (operation === "stop") {
          reply(res, 200, {
            kind: "ok",
            value: { status: "accepted", epoch: auth.epoch },
          });
          stop();
          return;
        }
        if (operation === "token-rotate") {
          acquired.access.rotate();
          await Promise.all([...retirements]);
          reply(res, 200, {
            kind: "ok",
            value: { status: "rotated", epoch: auth.epoch },
          });
          return;
        }
        throw new ContractError("invalid");
      }
      assert();
      // Never accept an injected local header on the public multiplexing routes.
      if (boundary.headers.has("x-cadence-local"))
        throw new ContractError("forbidden");
      const project = target(raw);
      const caller = auth.authenticate(
        boundary,
        randomUUID(),
        !project && req.method === "POST",
      );
      if (project) {
        const route = readRoute(project.tail, req.method ?? "");
        if (!route) throw new ContractError("invalid");
        const attachment = boundary.headers.get("x-cadence-attachment");
        if (
          (attachment && attachments.get(attachment) !== project.id) ||
          (req.method === "POST" && !attachment)
        )
          throw new ContractError("stale");
        if (
          route.operation === "session" &&
          !attachment &&
          attachments.size >= 2048
        )
          throw new ContractError("capacity");
        if (
          req.method === "POST" &&
          boundary.headers.get("origin") !== boundary.origin
        )
          throw new ContractError("forbidden");
        if (
          req.headers["content-encoding"] ||
          req.headers["transfer-encoding"] ||
          Number(req.headers["content-length"] ?? 0) > LIMITS.controlBytes
        )
          throw new ContractError("oversize");
        let commandBody: string | undefined;
        if (route.operation === "workbenchCommand") {
          const command = decodeWorkbenchCommand(
            await body(req, LIMITS.controlBytes),
          );
          // Legacy direct-project navigation returns an independent token link
          // and does not register that owner here. Never proxy it: all gateway
          // openings must use /workbench/v1/open and join this workbench's Stop.
          if (command.kind === "open-project")
            throw new ContractError("forbidden");
          commandBody = canonicalJson(command, LIMITS.controlBytes);
        }
        const b = await binding(project.id);
        auth.current(caller);
        assert();
        const headers: Record<string, string> = {
          Cookie: b.cookie,
          Origin: b.endpoint,
        };
        for (const key of [
          "content-type",
          "content-length",
          "x-cadence-build",
          "x-cadence-attachment",
          "x-cadence-csrf",
        ]) {
          const value = boundary.headers.get(key);
          if (value !== undefined) headers[key] = value;
        }
        if (commandBody !== undefined)
          headers["content-length"] = String(Buffer.byteLength(commandBody));
        await new Promise<void>((resolve) => {
          const upstream = request(
            `${b.endpoint}${project.tail}`,
            { method: req.method, headers, agent: false },
            (incoming) => {
              try {
                auth.current(caller);
              } catch {
                close();
                return;
              }
              if (
                route.operation === "session" &&
                incoming.statusCode === 200
              ) {
                try {
                  attachments.set(
                    decodeId(incoming.headers["x-cadence-attachment"]),
                    project.id,
                  );
                } catch {
                  close();
                  return;
                }
              }
              if (
                route.operation === "detach" &&
                incoming.statusCode === 200 &&
                attachment
              )
                attachments.delete(attachment);
              res.statusCode = incoming.statusCode ?? 502;
              for (const key of [
                "content-type",
                "content-disposition",
                "x-cadence-attachment",
              ]) {
                const value = incoming.headers[key];
                if (value !== undefined) res.setHeader(key, value);
              }
              incoming.on("error", close);
              incoming.pipe(res);
              res.once("finish", done);
            },
          );
          function done() {
            relays.delete(close);
            res.off("close", close);
            res.off("finish", done);
            resolve();
          }
          function close() {
            upstream.destroy();
            res.destroy();
            done();
          }
          relays.add(close);
          res.once("close", close);
          upstream.setTimeout(LIMITS.downloadIdleMs, close);
          upstream.on("error", () => {
            if (!res.headersSent)
              reply(res, 502, {
                kind: "error",
                error: publicError(
                  "unavailable",
                  req.method === "POST" ? "uncertain" : "none",
                ),
              });
            else res.destroy();
            done();
          });
          if (commandBody === undefined) req.pipe(upstream);
          else upstream.end(commandBody);
        });
        return;
      }
      if (raw === "/workbench/v1" && req.method === "GET") {
        reply(res, 200, {
          kind: "workbench",
          epoch: auth.epoch,
          csrf: auth.csrf,
          home: homedir(),
          projects: store.projects(),
          build,
        });
        return;
      }
      if (
        url.pathname === "/workbench/v1/directories" &&
        req.method === "GET" &&
        [...url.searchParams.keys()].join() === "path"
      ) {
        reply(
          res,
          200,
          files.list(text(url.searchParams.get("path"), 4096, true), true),
        );
        return;
      }
      if (raw === "/workbench/v1/open" && req.method === "POST") {
        const clientBuild = decodeClientBuild(
          parseWireJson(
            boundary.headers.get("x-cadence-build") ?? "null",
            1024,
          ),
        );
        if (
          clientBuild.kind !== "browser" ||
          !compatibleBuild(build, clientBuild)
        )
          throw new ContractError("unsupported-context");
        const o = closed(await body(req), ["commandId", "path", "epoch"]);
        const id = decodeId(o.commandId),
          path = text(o.path, 4096, true),
          epoch = decodeId(o.epoch);
        auth.current(caller);
        effect = true;
        const project = await open(path, id, epoch);
        auth.current(caller);
        reply(res, 200, { kind: "project", project });
        return;
      }
      const app =
        url.pathname === "/app" &&
        (raw === "/app" ||
          (/^[a-f0-9]{64}$/.test(url.searchParams.get("project") ?? "") &&
            [...url.searchParams.keys()].join() === "project"));
      const asset = assets.get(app ? "/app" : raw);
      if (req.method !== "GET" || !asset) throw new ContractError("invalid");
      res.setHeader("Content-Type", asset.contentType);
      res.end(asset.bytes);
    } catch (error) {
      const code = error instanceof ContractError ? error.code : "unavailable";
      if (res.headersSent) res.destroy();
      else
        reply(
          res,
          code === "unauthenticated" ? 401 : code === "forbidden" ? 403 : 400,
          {
            kind: "error",
            error: publicError(code, effect ? "uncertain" : "none"),
          },
        );
    } finally {
      pending--;
    }
  }
  server.on("upgrade", (req, socket, head) => {
    void (async () => {
      try {
        assert();
        const boundary = requestBoundary(req, input.policy, endpoint),
          raw = req.url ?? "";
        assertRequestTarget(raw);
        if (boundary.headers.has("x-cadence-local"))
          throw new ContractError("forbidden");
        const caller = auth.authenticate(boundary, randomUUID(), false, true),
          t = target(raw);
        if (req.method !== "GET" || !t) throw new ContractError("invalid");
        const url = new URL(t.tail, endpoint),
          attachment = decodeId(url.searchParams.get("attachment"));
        if (
          attachments.get(attachment) !== t.id ||
          t.tail !== `${WS_PATH}?attachment=${attachment}`
        )
          throw new ContractError("invalid");
        const b = await binding(t.id);
        auth.current(caller);
        assert();
        const upstream = new WebSocket(
          `${b.endpoint.replace("http:", "ws:")}${t.tail}`,
          {
            headers: { Cookie: b.cookie, Origin: b.endpoint },
            agent: false,
            maxPayload: LIMITS.controlBytes,
            handshakeTimeout: 5000,
            perMessageDeflate: false,
          },
        );
        const abort = () => {
          upstream.terminate();
          socket.destroy();
          relays.delete(abort);
        };
        relays.add(abort);
        socket.once("close", abort);
        upstream.once("error", abort);
        upstream.once("close", abort);
        upstream.once("open", () => {
          try {
            auth.current(caller);
            assert();
          } catch {
            abort();
            return;
          }
          wss.handleUpgrade(req, socket, head, (client) => {
            const forward = (
              to: WebSocket,
              data: Buffer | Buffer[] | ArrayBuffer,
              binary: boolean,
            ) => {
              try {
                auth.current(caller);
                if (to.bufferedAmount > LIMITS.controlBytes) throw new Error();
                to.send(data, { binary });
              } catch {
                abort();
              }
            };
            client.on("message", (data, binary) =>
              forward(upstream, data, binary),
            );
            upstream.on("message", (data, binary) =>
              forward(client, data, binary),
            );
            client.on("error", abort);
            client.on("close", abort);
          });
        });
      } catch {
        socket.end(
          "HTTP/1.1 403 Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
      }
    })();
  });
  return { store, endpoint, epoch: acquired.registration.epoch, stop };
}
