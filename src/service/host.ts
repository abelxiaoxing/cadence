/** One real owner, original lifetimes, actions, retained readers and authenticated clients. */
import { lstatSync, opendirSync } from "node:fs";
import { join } from "node:path";
import { loadAgentDefinitions } from "../agent-registry.ts";
import { HistoryFiles, type HistoryReadBudget } from "../history/files.ts";
import { HistoryLive } from "../history/live.ts";
import { HistoryNavigation } from "../history/navigation.ts";
import { HistoryProjection } from "../history/projection.ts";
import { HistoryReader } from "../history/reader.ts";
import { HistoryWriter } from "../history/writer.ts";
import { loadWebAssets } from "../service-assets.ts";
import {
  ContractError,
  type ControlContext,
  canonicalJson,
  decodeHash,
  decodeId,
  publicError,
} from "../service-contract.ts";
import {
  resolveWorkspace,
  safeDirectory,
  type TaskStore,
} from "../task-store.ts";
import type { TaskRecord } from "../task-types.ts";
import { diagnosticText } from "../verification-diagnostics.ts";
import { sanitizeText } from "../worker-redaction.mjs";
import {
  AccessMaterial,
  HttpAuthentication,
  type TokenSource,
} from "./auth.ts";
import { AuthNetwork } from "./auth-network.ts";
import { ServiceCoordination } from "./coordination.ts";
import { ServiceHttpServer } from "./http.ts";
import { OwnerModelChoice } from "./model-choice.ts";
import { piSource, readPiAuth, readPiModels } from "./model-config.ts";
import { OwnerModelContext } from "./model-context.ts";
import { ServiceOwner } from "./owner.ts";
import { encoded, hash } from "./private-files.ts";
import {
  decodeHostInput,
  type HostInput,
  hostEnvironment,
  readHostConfig,
  reselectable,
  StartupRefusal,
  type StartupStage,
} from "./runtime.ts";
import { readServerConfig } from "./server-config.ts";
import { TaskActions } from "./task-actions.ts";
import { Workbench } from "./workbench.ts";

function legacy(
  store: TaskStore,
  budget: HistoryReadBudget,
  reader: HistoryReader,
): TaskRecord[] {
  if (!safeDirectory(store.tasks)) return [];
  // Only committed Create rows are indexed under the workspace ID. Exclude their
  // v1 summaries from the separate legacy inventory, without a whole-history cache.
  const navigation = new HistoryNavigation(reader.files);
  const created = new Set<string>();
  const snapshot = navigation.latest(budget);
  for (const batch of navigation.reverseBatches(
    reader.files.format.workspaceId,
    snapshot,
    budget,
  ))
    for (const row of batch.rows) {
      const value = row.value;
      if (
        value.kind === "admission" &&
        value.intent.createdTaskId &&
        value.intent.identity.kind === "action" &&
        value.intent.identity.action.kind === "create"
      ) {
        created.add(value.intent.createdTaskId);
        if (created.size > 1000) throw new ContractError("capacity");
      }
    }
  const dir = opendirSync(store.tasks),
    records: TaskRecord[] = [];
  let entries = 0;
  try {
    for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
      if (++entries > 1000) throw new ContractError("capacity");
      decodeId(entry.name);
      if (created.has(entry.name)) continue;
      const path = join(store.tasks, entry.name, "task.json");
      const size = lstatSync(path).size;
      if (size > 128 * 1024) throw new ContractError("corrupt-selected");
      budget.reserve(size);
      const record = store.load(entry.name);
      if (!record) throw new ContractError("corrupt-selected");
      records.push(record);
    }
  } finally {
    dir.closeSync();
  }
  return records;
}
declare const __CADENCE_SERVICE_CONTRACT__: string;
export interface ServiceHost {
  /** Null only in explicitly deferred source-boundary fixtures, never compiled production. */
  actions: TaskActions | null;
  workbench: Workbench | null;
  coordination: ServiceCoordination;
  owner: ServiceOwner;
  writer: HistoryWriter;
  reader: HistoryReader;
  projection: HistoryProjection;
  live: HistoryLive;
  models: OwnerModelContext;
  choice: OwnerModelChoice;
  access: AccessMaterial;
  http: ServiceHttpServer;
  endpoint: string;
  /** Launch-frozen ordinary environment, never model/access material. */
  checkEnvironment: Readonly<NodeJS.ProcessEnv>;
}
/** A pre-bind refusal names its fixed stage; nothing is registered yet. */
function refuseAt<T>(stage: StartupStage, step: () => T): T {
  try {
    return step();
  } catch (error) {
    // Never inspect OS exception properties or expose paths/configuration bytes.
    throw new StartupRefusal(
      error instanceof ContractError ? error.code : "unavailable",
      stage,
    );
  }
}
/** Explicit management only; imported code itself has no SDK/filesystem effects. */
export async function createServiceHost(
  value: HostInput,
  sourceBuild?: {
    contractHash: string;
    deferActions?: true;
    workerTimeoutMs?: number;
    webDirectory?: string;
  },
): Promise<ServiceHost> {
  const embedded =
    typeof __CADENCE_SERVICE_CONTRACT__ === "undefined"
      ? null
      : __CADENCE_SERVICE_CONTRACT__;
  if (embedded && sourceBuild) throw new ContractError("unsupported-context");
  const contractHash = decodeHash(embedded ?? sourceBuild?.contractHash);
  // Validate the full package-relative closure BEFORE bind, including the Agent
  // profiles TaskActions reads at construction (only deferred by source tests).
  const web = refuseAt("package", () => {
    if (!sourceBuild?.deferActions) loadAgentDefinitions();
    return loadWebAssets(sourceBuild?.webDirectory);
  });
  const build = {
    contractHash,
    assets: {
      sourceHash: web.manifest.sourceHash,
      contractHash: web.manifest.contractHash,
      buildId: web.manifest.buildId,
    },
  };
  const input = decodeHostInput(value);
  const launch = hostEnvironment(process.env);
  const network = new AuthNetwork(); // capture BEFORE SDK imports
  const c = new ServiceCoordination(input.workspace, input.stateHome);
  if (resolveWorkspace(input.config.cwd).root !== c.store.root)
    throw new ContractError("conflict");
  const old = readHostConfig(c);
  // Existing selected setup is all-or-refuse, never filled in by restart; only
  // the server configuration may explicitly reselect a stopped one's port and
  // token source, under the owner reservation below.
  const reselect = !!old && encoded(old) !== encoded(input.config);
  if (old && reselect && !reselectable(old, input.config))
    throw new ContractError("conflict");
  // Read once, before binding: a later edit applies at the next start and can
  // never fence or quarantine this owner. It must name the selected port.
  const configured =
    input.config.tokenSource === "config" && input.config.tokenFile
      ? readServerConfig(input.config.tokenFile).config
      : undefined;
  if (configured && configured.port !== input.config.http.port)
    throw new ContractError("conflict");
  const source: TokenSource =
    input.environmentToken !== null
      ? { environment: input.environmentToken }
      : configured && input.config.tokenFile
        ? { serverConfig: input.config.tokenFile, token: configured.token }
        : input.config.tokenFile
          ? { tokenFile: input.config.tokenFile }
          : {};
  AccessMaterial.validateSource(source);
  if (old) {
    if (reselect)
      AccessMaterial.validateReselection(c.files, c.directory, source);
    else new AccessMaterial(c.files, c.directory, source);
    const history = HistoryFiles.open(c);
    if (!history) throw new ContractError("corrupt-selected");
    history.assertWritable();
  }
  // Selected Pi sources are refused before bind too: a configuration refusal
  // never registers an owner that would quarantine. load() rereads them later.
  const home = launch.HOME ?? launch.USERPROFILE ?? input.config.agentDir;
  const pi = refuseAt("pi-agent-directory", () =>
    piSource(input.config.agentDir, home, input.config.cwd, launch),
  );
  refuseAt("pi-auth", () => readPiAuth(pi));
  refuseAt("pi-models", () => readPiModels(pi));
  const http = new ServiceHttpServer({
    policy: input.config.http,
    assets: web.assets,
  });
  const endpoint = await http.listen(); // bind before metadata, credential runtime, or auth
  let owner: ServiceOwner | undefined;
  let stage: StartupStage = "service";
  try {
    const resolved = {
      ...input.config,
      http: { ...input.config.http, port: Number(new URL(endpoint).port) },
    };
    const lease = c.acquire(
      {
        schema: "cadence-service-owner-config/1",
        endpoint,
        policyIdentity: hash(encoded(resolved)),
      },
      endpoint,
      () => {
        c.files.create(c.path("host-config.json"), encoded(resolved));
        AccessMaterial.initialize(c.files, c.directory, source);
      },
      reselect && old
        ? (previous) => {
            if (previous.identity !== hash(encoded(old)))
              throw new ContractError("conflict");
            AccessMaterial.reselect(c.files, c.directory, source);
            c.files.replace(
              c.path("host-config.json"),
              previous,
              encoded(resolved),
            );
          }
        : undefined,
    );
    let writer: HistoryWriter | undefined, live: HistoryLive | undefined;
    owner = new ServiceOwner(lease, {
      quiesce: () => http.quiesce(),
      flush: () => {
        if (!writer) throw new ContractError("unavailable");
        return writer.flush();
      },
      closeListener: async () => {
        live?.close();
        // Both originals are started/handled independently. No lock release until
        // the owned dispatcher AND listener actually close.
        const results = await Promise.allSettled([
          network.close(),
          http.close(),
        ]);
        if (results.some((r) => r.status === "rejected"))
          throw new ContractError("quarantine");
      },
    });
    const heldOwner = owner;
    if (!old) HistoryFiles.initialize(lease);
    writer = new HistoryWriter(lease, {
      onOriginal: (original, safety) =>
        heldOwner.trackHistory(original, safety),
      onFence: () => heldOwner.quarantine(),
    });
    const heldWriter = writer;
    const reader = HistoryReader.open(c);
    if (!reader) throw new ContractError("unavailable");
    const access = new AccessMaterial(c.files, c.directory, source, () =>
      lease.assert(),
    );
    const native = c.localAccess();
    const auth = new HttpAuthentication(
      access,
      native.epoch,
      reader.files.format.workspaceId,
      native.capability,
    );
    const models = new OwnerModelContext({
      owner,
      accounting: writer.auth,
      network,
      home,
      agentDir: input.config.agentDir,
      cwd: input.config.cwd,
      environment: launch,
    });
    const choice = new OwnerModelChoice({ owner, writer, models, access });
    const { PI_OFFLINE: _offline, ...ordinary } = launch;
    const checkEnvironment = Object.freeze(ordinary);
    const actions = sourceBuild?.deferActions
      ? null
      : new TaskActions({
          host: {
            coordination: c,
            owner,
            writer,
            reader,
            models,
            access,
            checkEnvironment,
          },
          choice,
          cwd: input.config.cwd,
          ownerSecrets: [
            ...access.redactionLiterals(),
            native.capability,
            ...network.literals,
          ],
          workerTimeoutMs: sourceBuild?.workerTimeoutMs,
        });
    const workbench = actions
      ? new Workbench({
          coordination: c,
          owner,
          models,
          choice,
          actions,
          cwd: input.config.cwd,
          agentDir: input.config.agentDir,
          projectsEnabled: !input.config.http.proxy,
          hostUrl: new URL(
            sourceBuild ? "../service-host.mjs" : "./service-host.mjs",
            import.meta.url,
          ),
          secrets: () => [
            ...access.redactionLiterals(),
            native.capability,
            ...network.literals,
            ...models.viewRedactionLiterals(),
          ],
          timeoutMs: sourceBuild?.workerTimeoutMs,
        })
      : null;
    const unavailable = (taskId: string | null): ControlContext => ({
      status: "unavailable",
      workspaceId: reader.files.format.workspaceId,
      taskId,
      error: publicError(
        owner?.state === "idle" ? "unavailable" : "quarantine",
      ),
    });
    const projection = new HistoryProjection(reader, {
      session: () => {
        lease.assert();
        return {
          protocol: 1,
          storeId: reader.storeId,
          epoch: native.epoch,
          accessGeneration: access.generation,
          authority: "local",
          csrf: null,
          capabilities: {
            actions: !!actions && !!choice.snapshot().selected,
            manualChecks: !!actions && !!choice.snapshot().selected,
            history: true,
          },
        };
      },
      workspace: () =>
        actions?.workspace() ?? {
          rootLabel: diagnosticText(c.store.root, 4096),
          models: models.observe(),
          context: unavailable(null),
        },
      context: (id) => actions?.context(id) ?? unavailable(id),
      checkObligations: actions
        ? (id) => actions.checkObligations(id)
        : undefined,
      checks: (id) => {
        if (actions) return actions.checks(id);
        throw new ContractError("unavailable");
      },
      legacyTasks: (budget) => {
        const literals = () => [
          ...access.redactionLiterals(),
          native.capability,
          ...models.viewRedactionLiterals(),
        ];
        const before = literals();
        // The retained projector uses only the legacy goal; never expose an old
        // human-readable summary as an unsanitized private-credential channel.
        const records = legacy(c.store, budget, reader).map((record) => ({
          ...record,
          goal: sanitizeText(record.goal, before),
        }));
        if (canonicalJson(before) !== canonicalJson(literals()))
          throw new ContractError("stale");
        return records;
      },
    });
    live = new HistoryLive(writer, projection);
    let stopRequested = false;
    let ready = false;
    http.configure({
      auth,
      build,
      adapters: {
        workbench: workbench ?? undefined,
        admission: actions?.admission ?? null,
        models: choice,
        modelChoice: actions ? choice : undefined,
        current: actions ?? undefined,
        projection,
        live,
        receipts: async (id) => {
          const found = await heldWriter.lookup(id);
          return found.status === "found"
            ? { status: "found" as const, receipt: found.record.receipt }
            : found.status === "absent"
              ? found
              : {
                  status: "inconclusive" as const,
                  error: publicError("receipt-inconclusive", "uncertain"),
                };
        },
      },
      management: {
        invoke: (operation) => {
          lease.assert();
          if (operation === "status" || operation === "diagnose")
            return {
              status:
                heldOwner.state === "idle"
                  ? ready
                    ? "alive"
                    : "unavailable"
                  : heldOwner.state,
              epoch: native.epoch,
              actions:
                heldOwner.state === "idle" &&
                !!actions &&
                ready &&
                !!choice.snapshot().selected,
              ...(operation === "diagnose"
                ? {
                    recording: heldWriter.quarantined
                      ? "quarantined"
                      : "available",
                    pendingWrites: heldWriter.pendingWrites,
                    pendingPreparations: models.pending,
                    proxyAuth: network.mode,
                    recovery: "local-interactive-only",
                  }
                : {}),
            };
          if (operation === "stop") {
            if (!stopRequested) {
              stopRequested = true;
              setImmediate(() => {
                void heldOwner.stop().finally(() => {
                  stopRequested = false;
                });
              });
            }
            return { status: "accepted", epoch: native.epoch };
          }
          if (heldOwner.state !== "idle") throw new ContractError("quarantine");
          if (operation === "token-link")
            return {
              link: access.tokenLink(resolved.http.proxy?.origin ?? endpoint),
            };
          access.rotate();
          return { status: "rotated", generation: access.generation };
        },
      },
    });
    if (writer.quarantined) {
      owner.quarantine();
      throw new ContractError("quarantine");
    }
    stage = "pi-runtime";
    const loading = models.load();
    owner.trackAuth(loading); // original construction promise, no caller reporting race
    await loading;
    stage = "service";
    lease.assert();
    if (owner.state !== "idle") throw new ContractError("quarantine");
    ready = true;
    http.admit();
    return {
      actions,
      workbench,
      coordination: c,
      owner,
      writer,
      reader,
      projection,
      live,
      models,
      choice,
      access,
      http,
      endpoint,
      checkEnvironment,
    };
  } catch (error) {
    if (owner) {
      owner.quarantine();
      // Construction has settled; independently close any allocated route even
      // if installation failed. Keep its original promise and all owner fences.
      const closing = network.close();
      void closing.catch(() => {});
      try {
        owner.trackAuth(closing);
      } catch {
        /* late tracking retains the original */
      }
    } else await http.close();
    // An acquired uncertain owner stays alive/fenced for local diagnosis. No
    // automatic release, repair, kill or restart after an initialization error.
    throw new StartupRefusal(
      error instanceof ContractError ? error.code : "unavailable",
      stage,
      !!owner,
    );
  }
}
