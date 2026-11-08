/** One authenticated UI origin, no default project, no execution runtime on discovery.
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
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { HistoryFiles } from "../history/files.ts";
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
import { effectiveWorkspace } from "../workspace.ts";
import { ActivityDiscoveryReader } from "./activity-discovery.ts";
import { HttpAuthentication, requestBoundary } from "./auth.ts";
import { hostSystem, serviceConfigPath } from "./autostart.ts";
import {
  nativeCall,
  openProjectDirectory,
  ownerControl,
  serviceStatus,
  stopService,
} from "./cli.ts";
import { localOrigin } from "./config.ts";
import {
  closed,
  decodeHash,
  decodeId,
  integer,
  oneOf,
  text,
} from "./contracts/core.ts";
import {
  canUpgrade,
  decodeProjectEntry,
  decodeVersion,
  MAINTENANCE_ACTIONS,
  type MaintenanceJob,
  type ServiceEntry,
} from "./contracts/gateway.ts";
import {
  type ConversationLocation,
  decodeConversationLocation,
} from "./contracts/models.ts";
import {
  decodeWorkbenchCommand,
  decodeWorkbenchRead,
  decodeWorkbenchResult,
} from "./contracts/workbench.ts";
import { ConversationContextRecords } from "./conversation-contexts.ts";
import { ServiceCoordination } from "./coordination.ts";
import {
  GatewayConversations,
  unpreparedDirectory,
} from "./gateway-conversations.ts";
import { readGatewayModels } from "./gateway-models.ts";
import {
  decodeGatewayInput,
  type GatewayInput,
  type GatewayProject,
  GatewayStore,
} from "./gateway-store.ts";
import { fixedHeaders } from "./http.ts";
import {
  installation,
  packageCommands,
  type UpgradeRoute,
  upgradeRoute,
} from "./installation.ts";
import {
  installedVersion,
  jobRunning,
  launchJob,
  MaintenanceRecord,
  releaseForInstallation,
  supervisingUnit,
} from "./maintenance.ts";
import { ModelPreviewProcesses } from "./model-preview-process.ts";
import { encoded, hash, json } from "./private-files.ts";
import { type LiveLedger, ProcessLedger } from "./process-ledger.ts";
import { RecoveryLog } from "./recovery-log.ts";
import { healWorkbench, RegistryHealer } from "./self-heal.ts";
import { readServerConfig } from "./server-config.ts";
import { WorkbenchFiles } from "./workbench-files.ts";

declare const __CADENCE_SERVICE_CONTRACT__: string;
interface Binding {
  project: GatewayProject;
  endpoint: string;
  cookie: string;
}
/** Serial owner settlement avoids racing their shared registry writer.
 * Resolves with the projects whose Stop was not confirmed; each keeps its own
 * state, which its next start recovers if the owner has died meanwhile. */
export async function joinProjectStops(
  projects: readonly GatewayProject[],
  stopProject: (project: GatewayProject) => Promise<void>,
): Promise<GatewayProject[]> {
  const unconfirmed: GatewayProject[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    const key = canonicalJson([project.path, project.epoch]);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await stopProject(project);
    } catch {
      // One changed/unknown owner must not prevent Stop reaching the others.
      // Do not signal a changed epoch or upgrade an unconfirmed result.
      unconfirmed.push(project);
    }
  }
  return unconfirmed;
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
  // Reclaim what a dead predecessor left behind, before binding the port.
  const registryHeal = await new RegistryHealer(
    new ServiceCoordination(null, input.stateHome),
  ).heal();
  if (registryHeal.status === "blocked")
    throw new ContractError("registry-locked");
  const healed = await healWorkbench(store, { responsive: async () => true });
  if (healed.status === "blocked" || healed.status === "live")
    throw new ContractError("quarantine");
  const assets = new Map(web.assets.map((asset) => [asset.path, asset]));
  const connections = new Set<Socket>(),
    relays = new Set<() => void>();
  const preparations = new Map<
    string,
    { identity: string; result: Promise<GatewayProject> }
  >();
  const retirements = new Set<Promise<void>>();
  const attachments = new Map<string, { projectId: string; epoch: string }>();
  const bindings = new Map<
    string,
    { epoch: string; result: Promise<Binding> }
  >();
  const conversations = new GatewayConversations(
    input.stateHome,
    input.agentDir,
    () => acquired.access.redactionLiterals(),
  );
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
  let preparing = false;
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
      conversations.close();
      const grouped = new Map<
        string,
        { projectId: string; epoch: string; ids: string[] }
      >();
      for (const [id, target] of attachments) {
        const key = `${target.projectId}:${target.epoch}`;
        const group = grouped.get(key) ?? { ...target, ids: [] };
        group.ids.push(id);
        grouped.set(key, group);
      }
      attachments.clear();
      const original = (async () => {
        for (const { projectId: id, epoch, ids } of grouped.values()) {
          const project = store.projects().find((p) => p.id === id);
          if (!project) throw new ContractError("unavailable");
          const c = new ServiceCoordination(project.path, input.stateHome);
          if (c.inspect().status === "stopped") continue;
          if (c.localAccess().epoch !== epoch) {
            if ((await binding(id)).project.epoch !== epoch) continue;
            throw new ContractError("stale");
          }
          for (let offset = 0; offset < ids.length; offset += LIMITS.viewers) {
            const result = closed(
              await nativeCall(c, "detach-viewers", false, {
                attachments: ids.slice(offset, offset + LIMITS.viewers),
              }),
              ["status", "epoch"],
            );
            if (result.status !== "detached" || result.epoch !== epoch)
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
  const activity = new ActivityDiscoveryReader({
    stateHome: input.stateHome,
    agentDir: input.agentDir,
    epoch: auth.epoch,
    build,
    readOwner: (c, signal) =>
      nativeCall(c, "activity", false, undefined, signal),
    secrets: () => acquired.access.redactionLiterals(),
  });
  acquired.access.onRevoke(() => activity.invalidate());
  const files = new WorkbenchFiles(
    homedir(),
    [store.files.namespace, input.agentDir],
    () => acquired.access.redactionLiterals(),
  );
  const assert = () => {
    store.assert();
    if (!accepting) throw new ContractError("quarantine");
  };
  let previewLedger: LiveLedger | undefined;
  const modelPreviews = new ModelPreviewProcesses({
    worker: new URL("./model-preview.mjs", hostUrl),
    assertCurrent: () => store.assert(),
    launched: (pid) => {
      previewLedger ??= new ProcessLedger(store.files).open(auth.epoch);
      previewLedger.add(pid);
    },
    closed: (pid) => previewLedger?.remove(pid),
    unconfirmed: () => stop(),
  });
  acquired.access.onRevoke(() => modelPreviews.invalidate());
  const root = dirname(dirname(fileURLToPath(hostUrl))),
    version = installedVersion(root),
    record = new MaintenanceRecord(store);
  // Only the generated unit this workbench runs in can be restarted from here.
  const managed = (() => {
    const s = supervisingUnit(process.env, (selection) =>
      hostSystem(root, ownerControl, selection),
    );
    return s && serviceConfigPath(s) === input.serverConfig ? s : undefined;
  })();
  const packageSystem = managed ?? hostSystem(root, ownerControl, {});
  const commands = packageCommands(packageSystem);
  let route: Promise<UpgradeRoute> | undefined,
    requesting = false;
  /** Accepted work in associated running owners: what a restart stops. */
  async function associatedWork(): Promise<number> {
    const counts = await Promise.all(
      [
        ...new Map(store.associatedProjects().map((p) => [p.path, p])).values(),
      ].map(async (p) => {
        try {
          const observed = await serviceStatus(
            new ServiceCoordination(p.path, input.stateHome),
          );
          return observed &&
            typeof observed === "object" &&
            "status" in observed &&
            observed.status === "alive" &&
            "work" in observed &&
            typeof observed.work === "number"
            ? observed.work
            : 0;
        } catch {
          return 0;
        }
      }),
    );
    return counts.reduce((sum, count) => sum + count, 0);
  }
  function latestJob(): MaintenanceJob | null {
    const job = record.read();
    // Ended without reporting: killed, or stopped by its runtime bound.
    return job?.state === "running" && managed && !jobRunning(managed)
      ? { ...job, state: "failed", reason: "interrupted" }
      : job;
  }
  async function serviceEntry(): Promise<ServiceEntry> {
    route ??= upgradeRoute(packageSystem, commands);
    return {
      kind: "service",
      version,
      unit: managed
        ? { name: managed.unit, scope: managed.scope ?? "user" }
        : null,
      upgrade: await route,
      work: await associatedWork(),
      job: latestJob(),
    };
  }
  /** A request must name the exact state the browser confirmed. */
  async function requestJob(
    value: unknown,
    current: () => void,
  ): Promise<MaintenanceJob> {
    const o = closed(value, ["action", "from", "to", "work", "epoch"]);
    const action = oneOf(o.action, MAINTENANCE_ACTIONS),
      to = o.to === null ? null : decodeVersion(o.to);
    if ((action === "upgrade") !== (to !== null))
      throw new ContractError("invalid");
    if (decodeId(o.epoch) !== auth.epoch || decodeVersion(o.from) !== version)
      throw new ContractError("stale");
    if (!managed) throw new ContractError("unsupported-context");
    route = upgradeRoute(packageSystem, commands);
    if (action === "upgrade" && !canUpgrade(await route))
      throw new ContractError("unsupported-context");
    if (requesting || jobRunning(managed)) throw new ContractError("conflict");
    requesting = true;
    try {
      if ((await associatedWork()) !== integer(o.work, 0, 1_000_000))
        throw new ContractError("stale");
      current();
      assert();
      const job: MaintenanceJob = {
        id: randomUUID(),
        action,
        from: version,
        to,
        state: "running",
        reason: null,
        version: null,
        at: Date.now(),
        endedAt: null,
      };
      record.write(job);
      if (!launchJob(managed, job)) {
        record.finish(job.id, "failed", "refused", version);
        throw new ContractError("unavailable");
      }
      return job;
    } finally {
      requesting = false;
    }
  }
  function browserBuild(boundary: ReturnType<typeof requestBoundary>): void {
    const clientBuild = decodeClientBuild(
      parseWireJson(boundary.headers.get("x-cadence-build") ?? "null", 1024),
    );
    if (clientBuild.kind !== "browser" || !compatibleBuild(build, clientBuild))
      throw new ContractError("unsupported-context");
  }
  /** Selection updates only the authenticated workbench's directory reference.
   * It never reserves a checkout, heals state, initializes Pi or starts an owner. */
  function select(path: string, epoch: string): GatewayProject {
    assert();
    if (epoch !== auth.epoch) throw new ContractError("stale");
    const directory = files.directory(path);
    effectiveWorkspace(directory, input.stateHome);
    const c = new ServiceCoordination(directory, input.stateHome);
    const id =
      store.projects().find((project) => project.cwd === directory)?.id ??
      hash(`directory\0${directory}`);
    const previous = store
      .associatedProjects()
      .find((project) => project.id === id);
    const project = {
      id,
      path: c.store.root,
      cwd: directory,
      epoch: previous?.epoch ?? null,
    };
    store.saveProject(project);
    return project;
  }
  /** One explicit Send may prepare its selected owner. This endpoint cannot
   * accept a message, choose a model, grant approval or submit a workflow. */
  async function prepareSend(
    projectId: string,
    id: string,
    epoch: string,
    current: () => void,
    location?: ConversationLocation,
  ): Promise<GatewayProject> {
    assert();
    if (epoch !== auth.epoch) throw new ContractError("stale");
    const selected = store
      .projects()
      .find((project) => project.id === projectId);
    if (!selected) throw new ContractError("unavailable");
    const context = location
      ? new ConversationContextRecords(
          new ServiceCoordination(selected.path, input.stateHome),
        ).read(location).context
      : null;
    if (context && context.cwd !== location?.cwd)
      throw new ContractError("stale");
    const directory = files.directory(context?.cwd ?? selected.cwd);
    effectiveWorkspace(directory, input.stateHome);
    const observed = new ServiceCoordination(directory, input.stateHome);
    if (observed.store.root !== selected.path) throw new ContractError("stale");
    const identity = canonicalJson({
      kind: "prepare-send",
      projectId,
      epoch,
      ...(location ? { location } : {}),
    });
    const intentPath = store.path(`commands/${id}.json`);
    const previous = (): Promise<GatewayProject> | undefined => {
      const pending = preparations.get(id);
      if (pending) {
        if (pending.identity !== identity) throw new ContractError("conflict");
        return pending.result;
      }
      const kept = store.files.read(intentPath);
      if (!kept) return undefined;
      if (kept.bytes.toString("utf8") !== identity)
        throw new ContractError("conflict");
      const settled = store.files.read(
        store.path(`commands/${id}.result.json`),
      );
      if (!settled) throw new ContractError("receipt-inconclusive");
      return Promise.resolve(decodeProjectEntry(json(settled)));
    };
    const prior = previous();
    if (prior) return prior;
    const running = (await serviceStatus(observed)) as { status?: string };
    current();
    assert();
    const concurrent = previous();
    if (concurrent) return concurrent;
    if (running.status === "alive") {
      const access = observed.localAccess();

      const project = { ...selected, epoch: access.epoch };
      if (
        store
          .associatedProjects()
          .some((p) => p.id === project.id && p.epoch === project.epoch)
      ) {
        bindings.delete(project.id);
        return project;
      }
    }
    if (running.status !== "alive" && process.env.CADENCE_AUTOSTART === "0")
      throw new ContractError("unsupported-context");
    if (preparing) throw new ContractError("capacity");
    if (preparations.size >= 128) throw new ContractError("capacity");
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
    current();
    assert();
    store.files.create(intentPath, identity);
    // Register the original before the launch microtask; browser departure never
    // cancels this accepted operation, and Stop waits its safety publications.
    preparing = true;
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
        id: selected.id,
        path: c.store.root,
        cwd: selected.cwd,
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
    preparations.set(id, { identity, result });
    void result.then(
      () => {
        preparations.delete(id);
        preparing = false;
      },
      () => {
        preparing = false;
      },
    );
    return result;
  }
  function binding(id: string): Promise<Binding> {
    let project = store.projects().find((p) => p.id === id);
    if (!project) throw new ContractError("unavailable");
    const c = new ServiceCoordination(project.path, input.stateHome),
      local = c.localAccess();
    if (c.store.root !== project.path) throw new ContractError("stale");
    if (local.epoch !== project.epoch) {
      // The same project's owner restarted (after recovering from a fault or
      // a crash): follow it instead of stranding this project's page.
      project = { ...project, epoch: local.epoch };
      // Merely reading a selected directory never adopts its owner's Stop
      // lifetime. Only Send preparation associates an exact epoch.
      if (store.associatedProjects().some((p) => p.id === id))
        store.saveProject(project);
    }
    const previous = bindings.get(id);
    if (previous?.epoch === local.epoch) return previous.result;
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
    bindings.set(id, { epoch: local.epoch, result });
    return result;
  }
  function stop(): void {
    if (stopping) return;
    accepting = false;
    activity.close();
    const previewsClosed = modelPreviews.close();
    void previewsClosed.catch(() => {});
    store.phase("stopping");
    stopping = (async () => {
      // An accepted Send preparation settles first; its owner (if any) is stopped
      // below like every other associated owner.
      await Promise.allSettled([...preparations.values()].map((o) => o.result));
      await Promise.allSettled([...retirements]);
      const targets = store.associatedProjects();
      // Owners share the short registry writer. Do not race their final release
      // by issuing simultaneous Stop requests from this workbench. An owner
      // that is not running (stopped, crashed, or its directory removed) has
      // nothing to stop; one that does not confirm keeps its own state.
      await joinProjectStops(targets, async (p) => {
        let c: ServiceCoordination;
        try {
          c = new ServiceCoordination(p.path, input.stateHome);
        } catch {
          return;
        }
        const observed = await serviceStatus(c);
        const status =
          observed && typeof observed === "object" && "status" in observed
            ? observed.status
            : "unavailable";
        if (status !== "alive") return;
        if (c.localAccess().epoch !== p.epoch) return;
        if ((await stopService(c)).status !== "stopped")
          throw new ContractError("quarantine");
      });
      await previewsClosed;
      previewLedger?.close();
      conversations.close();
      store.release();
      for (const close of relays) close();
      wss.close();
      server.close();
      for (const socket of connections) socket.end();
    })().catch(() => {
      // The workbench's own files changed under it. End the process: its
      // next start proves this one gone and recovers the registration.
      try {
        store.phase("quarantined");
      } catch {
        /* recovered at the next start */
      }
      server.close();
      for (const socket of connections) socket.destroy();
      // Preserve quarantine and the exact worker ledger for startup recovery.
      // A supervisor may restart this workbench; no admitted project is replayed.
      if (modelPreviews.uncertain) process.exit(75);
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
  function reply(
    res: ServerResponse,
    code: number,
    value: unknown,
    maximum = LIMITS.controlBytes,
  ) {
    if (res.destroyed || res.writableEnded) return;
    fixedHeaders(res);
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(canonicalJson(value, maximum));
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
        if (
          req.headers["content-encoding"] ||
          req.headers["transfer-encoding"] ||
          Number(req.headers["content-length"] ?? 0) > LIMITS.controlBytes
        )
          throw new ContractError("oversize");
        // Retained conversation reads use the workbench's access cookie, not
        // an execution attachment. An old attachment can be gone after Stop;
        // it cannot prevent reading, nor grant any authority on this route.
        if (route.operation === "workbenchRead" && req.method === "GET") {
          const selected = store.projects().find((p) => p.id === project.id);
          if (!selected) throw new ContractError("unavailable");
          const retained = conversations.read(
            selected,
            decodeWorkbenchRead(parseWireJson(route.input ?? "null")),
          );
          if (retained) {
            auth.current(caller);
            assert();
            reply(
              res,
              200,
              {
                kind: "ok",
                value: decodeWorkbenchResult(retained),
              },
              LIMITS.pageBytes,
            );
            return;
          }
        }
        if (
          route.operation === "session" &&
          !store.associatedProjects().some((p) => p.id === project.id)
        )
          throw new ContractError("unavailable");
        const attachment = boundary.headers.get("x-cadence-attachment");
        if (
          (attachment &&
            attachments.get(attachment)?.projectId !== project.id) ||
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
        const attached = attachment ? attachments.get(attachment) : undefined;
        if (route.operation === "detach" && attachment && attached) {
          const selected = store.projects().find((p) => p.id === project.id);
          if (!selected) throw new ContractError("unavailable");
          const observed = new ServiceCoordination(
            selected.path,
            input.stateHome,
          ).inspect();
          if (
            observed.status === "stopped" &&
            observed.epoch === attached.epoch
          ) {
            auth.current(caller);
            assert();
            attachments.delete(attachment);
            reply(res, 200, { kind: "ok", value: null });
            return;
          }
        }
        let commandBody: string | undefined;
        if (route.operation === "workbenchCommand") {
          const command = decodeWorkbenchCommand(
            await body(req, LIMITS.controlBytes),
          );
          // Legacy direct-project navigation returns an independent token link
          // and does not register that owner here. Never proxy it: all gateway
          // owner preparation must use the workbench's explicit Send boundary.
          if (command.kind === "open-project")
            throw new ContractError("forbidden");
          commandBody = canonicalJson(command, LIMITS.controlBytes);
        }
        const b = await binding(project.id);
        auth.current(caller);
        assert();
        // Do not forward an old epoch's CSRF/attachment through a new owner's
        // cookie. The authenticated successor proves this viewer superseded,
        // not that any earlier message was unaccepted or canceled.
        if (attachment && attached && attached.epoch !== b.project.epoch) {
          attachments.delete(attachment);
          reply(
            res,
            route.operation === "detach" ? 200 : 409,
            route.operation === "detach"
              ? { kind: "ok", value: null }
              : {
                  kind: "error",
                  error: publicError(
                    "stale",
                    req.method === "POST" ? "uncertain" : "none",
                  ),
                },
          );
          return;
        }
        const headers: Record<string, string> = {
          Cookie: b.cookie,
          Origin: b.endpoint,
        };
        for (const key of [
          "accept-encoding",
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
                    { projectId: project.id, epoch: b.project.epoch as string },
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
                "content-encoding",
                "content-disposition",
                "vary",
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
      const observation = /^\/workbench\/v1\/projects\/([a-f0-9]{64})$/.exec(
        raw,
      );
      if (observation && req.method === "GET") {
        const project = store.projects().find((p) => p.id === observation[1]);
        if (!project) throw new ContractError("unavailable");
        const c = new ServiceCoordination(project.path, input.stateHome);
        if (c.store.root !== project.path) throw new ContractError("stale");
        const observed = await serviceStatus(c);
        auth.current(caller);
        assert();
        const status =
          observed && typeof observed === "object" && "status" in observed
            ? observed.status
            : "unavailable";
        reply(res, 200, {
          kind: "project-observation",
          status:
            status === "alive"
              ? "running"
              : status === "stopped"
                ? "stopped"
                : unpreparedDirectory(c, project)
                  ? "not-started"
                  : "unavailable",
          epoch:
            observed && typeof observed === "object" && "epoch" in observed
              ? observed.epoch
              : null,
          workspaceId: HistoryFiles.open(c)?.format.workspaceId ?? null,
        });
        return;
      }
      if (url.pathname === "/workbench/v1/models" && req.method === "GET") {
        browserBuild(boundary);
        const keys = [...url.searchParams.keys()];
        if (keys.length && (keys.length !== 1 || keys[0] !== "project"))
          throw new ContractError("invalid");
        const id = url.searchParams.get("project");
        const selected =
          id === null
            ? undefined
            : store.projects().find((p) => p.id === decodeHash(id));
        if (id !== null && !selected) throw new ContractError("unavailable");
        const catalog = await readGatewayModels(
          selected,
          input,
          acquired.access.redactionLiterals(),
          (source) => modelPreviews.read(source),
        );
        auth.current(caller);
        assert();
        reply(res, 200, catalog, LIMITS.pageBytes);
        return;
      }
      if (raw === "/workbench/v1/activity" && req.method === "GET") {
        browserBuild(boundary);
        const value = await activity.read();
        auth.current(caller);
        assert();
        reply(res, 200, value);
        return;
      }
      if (raw === "/workbench/v1" && req.method === "GET") {
        reply(res, 200, {
          kind: "workbench",
          epoch: auth.epoch,
          csrf: auth.csrf,
          home: homedir(),
          projects: store.projects(),
          recoveries: new RecoveryLog(store.files).notices(),
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
      if (raw === "/workbench/v1/service" && req.method === "GET") {
        reply(res, 200, await serviceEntry());
        return;
      }
      // Registry contact only on an explicit check, never in the background.
      if (raw === "/workbench/v1/service/release" && req.method === "GET") {
        const selected = await installation(packageSystem, commands);
        route = Promise.resolve(selected.route);
        const latest = await releaseForInstallation(selected, commands);
        if (!latest) throw new ContractError("unavailable");
        reply(res, 200, { kind: "release", ...latest });
        return;
      }
      if (raw === "/workbench/v1/service" && req.method === "POST") {
        browserBuild(boundary);
        const value = await body(req);
        auth.current(caller);
        const job = await requestJob(value, () => auth.current(caller));
        reply(res, 200, { kind: "service-job", job });
        return;
      }
      if (raw === "/workbench/v1/select" && req.method === "POST") {
        browserBuild(boundary);
        const o = closed(await body(req), ["path", "epoch"]);
        const path = text(o.path, 4096, true),
          epoch = decodeId(o.epoch);
        auth.current(caller);
        effect = true;
        reply(res, 200, { kind: "project", project: select(path, epoch) });
        return;
      }
      if (raw === "/workbench/v1/prepare-send" && req.method === "POST") {
        browserBuild(boundary);
        const value = await body(req);
        const o = closed(value, [
          "commandId",
          "projectId",
          "epoch",
          ...(Object.hasOwn(value ?? {}, "location") ? ["location"] : []),
        ]);
        const id = decodeId(o.commandId),
          projectId = decodeHash(o.projectId),
          epoch = decodeId(o.epoch);
        const location =
          o.location === undefined
            ? undefined
            : decodeConversationLocation(o.location);
        auth.current(caller);
        effect = true;
        const project = await prepareSend(
          projectId,
          id,
          epoch,
          () => auth.current(caller),
          location,
        );
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
          attachments.get(attachment)?.projectId !== t.id ||
          t.tail !== `${WS_PATH}?attachment=${attachment}`
        )
          throw new ContractError("invalid");
        const b = await binding(t.id);
        if (attachments.get(attachment)?.epoch !== b.project.epoch)
          throw new ContractError("stale");
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
