/** One real owner, original lifetimes, current workflows, retained readers and authenticated clients. */
import { spawn } from "node:child_process";
import { lstatSync, opendirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAgentDefinitions } from "../agent-registry.ts";
import { CadencePreferences } from "../cadence-preferences.ts";
import type { HistoryReadBudget } from "../history/files.ts";
import { HistoryLive } from "../history/live.ts";
import { HistoryNavigation } from "../history/navigation.ts";
import { HistoryProjection } from "../history/projection.ts";
import { HistoryReader } from "../history/reader.ts";
import { healHistory } from "../history/recovery.ts";
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
import { observeProcesses } from "../subagent-process.ts";
import { legacyTaskStore, type TaskStore } from "../task-store.ts";
import type { TaskRecord } from "../task-types.ts";
import { diagnosticText } from "../verification-diagnostics.ts";
import { sanitizeText } from "../worker-redaction.mjs";
import { ownerDefaultInCheckout, safeDirectory } from "../workspace.ts";
import {
  AccessMaterial,
  HttpAuthentication,
  type TokenSource,
} from "./auth.ts";
import { AuthNetwork } from "./auth-network.ts";
import { CheckoutGate } from "./checkout-gate.ts";
import { ServiceCoordination } from "./coordination.ts";
import { ServiceHttpServer } from "./http.ts";
import { processStart, stopProcessGroup } from "./liveness.ts";
import { OwnerModelChoice } from "./model-choice.ts";
import { piSource, readPiAuth, readPiModels } from "./model-config.ts";
import { OwnerModelContext } from "./model-context.ts";
import { ServiceOwner } from "./owner.ts";
import { encoded, hash } from "./private-files.ts";
import { ProcessLedger } from "./process-ledger.ts";
import { RecoveryLog } from "./recovery-log.ts";
import {
  decodeHostInput,
  type HostInput,
  hostEnvironment,
  readHostConfig,
  reselectable,
  StartupRefusal,
  type StartupStage,
} from "./runtime.ts";
import { healProject, RegistryHealer } from "./self-heal.ts";
import { readServerConfig } from "./server-config.ts";
import { Workbench } from "./workbench.ts";

/** A restarted owner waits this long for the process it replaces to exit. */
const SUCCESSOR_WAIT_MS = 60_000;
/** Runtime faults restart the owner at most this many times in a row. */
const SELF_RESTARTS = 3;
/** Original work gets this long to settle before a faulted owner restarts. */
const FAULT_SETTLE_MS = 30_000;
async function predecessorExited(): Promise<void> {
  const pid = Number(process.env.CADENCE_SUCCESSOR_OF);
  if (!Number.isSafeInteger(pid) || pid < 1) return;
  const deadline = Date.now() + SUCCESSOR_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
/** Release what a dead predecessor left, before this owner registers. */
async function healBeforeStart(c: ServiceCoordination): Promise<void> {
  await predecessorExited();
  const registry = new RegistryHealer(c);
  const lock = await registry.heal();
  if (lock.status === "blocked" || lock.status === "live")
    throw new ContractError("registry-locked");
  await registry.sweep();
  const own = await healProject(c, { responsive: async () => true });
  if (own.status === "blocked") throw new ContractError("quarantine");
}

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
  /** Checkout ownership is independent of legacy tasks and history. */
  gate: CheckoutGate;
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
/** What only the real host process may do with its own lifetime. In-process
 * fixtures pass nothing, so a fault never ends a test runner. */
export interface HostLifetime {
  /** End this process; the next start heals what it leaves. */
  exit(code: number): void;
  /** Start a replacement owner that first waits for this process to exit. */
  successor(input: HostInput): void;
}
/** The production lifetime, used by service-host-entry.mjs. */
export const processLifetime: HostLifetime = {
  exit(code) {
    process.exit(code);
  },
  successor(input) {
    // A systemd unit restarts its own owner after the failed exit.
    if (process.env.CADENCE_SUPERVISED === "systemd") return;
    const previous = Number(process.env.CADENCE_RESTARTS ?? "0");
    // Only consecutive fast faults count toward the restart bound.
    const restarts = process.uptime() > 600 ? 0 : previous;
    if (!Number.isSafeInteger(restarts) || restarts >= SELF_RESTARTS) return;
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        fileURLToPath(new URL("./service-host.mjs", import.meta.url)),
      ],
      {
        detached: true,
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
        env: {
          ...process.env,
          CADENCE_SUCCESSOR_OF: String(process.pid),
          CADENCE_RESTARTS: String(restarts + 1),
        },
      },
    );
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(`${JSON.stringify(input)}\n`);
    child.unref();
  },
};
/** Explicit management only; imported code itself has no SDK/filesystem effects. */
export async function createServiceHost(
  value: HostInput,
  sourceBuild?: {
    contractHash: string;
    deferRuntime?: true;
    workerTimeoutMs?: number;
    webDirectory?: string;
  },
  lifetime?: HostLifetime,
): Promise<ServiceHost> {
  const embedded =
    typeof __CADENCE_SERVICE_CONTRACT__ === "undefined"
      ? null
      : __CADENCE_SERVICE_CONTRACT__;
  if (embedded && sourceBuild) throw new ContractError("unsupported-context");
  const contractHash = decodeHash(embedded ?? sourceBuild?.contractHash);
  // Validate the full package-relative closure BEFORE bind, including the Agent
  // profiles the current workflows load (only deferred by source tests).
  const web = refuseAt("package", () => {
    if (!sourceBuild?.deferRuntime) loadAgentDefinitions();
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
  // The saved default cwd remains metadata for unscoped callers. Its removal
  // cannot strand other conversations in this checkout; no default is rebased.
  if (!ownerDefaultInCheckout(c.store.root, input.config.cwd))
    throw new ContractError("conflict");
  await healBeforeStart(c);
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
    // History damage is healed after the lease below, never refused here.
  }
  // Selected Pi sources are refused before bind too: a configuration refusal
  // never registers an owner that would quarantine. load() rereads them later.
  const home = launch.HOME ?? launch.USERPROFILE ?? input.config.agentDir;
  const pi = refuseAt("pi-agent-directory", () =>
    piSource(input.config.agentDir, home, c.store.root, launch),
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
    let workbench: Workbench | null = null;
    // Evidence for a successor: the workers this epoch launches.
    const ledger = new ProcessLedger(c.files).open(lease.registration.epoch);
    observeProcesses({
      launched: (pid) => ledger.add(pid),
      closed: (pid) => ledger.remove(pid),
    });
    let ready = false,
      ending = false;
    /** After a fault (or an uncertain Stop) let original work settle, stop
     * this epoch's leftover workers and end the process; the replacement's
     * startup heal proves this owner gone and continues its history. */
    const endAfterFault = (restart: boolean) => {
      if (ending || !lifetime) return;
      ending = true;
      void (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          owner?.idle(),
          new Promise((resolve) => {
            timer = setTimeout(resolve, FAULT_SETTLE_MS);
          }),
        ]);
        clearTimeout(timer);
        // Only a worker whose start identity still matches is ours to stop.
        for (const worker of ledger.workers)
          if (!worker.started || processStart(worker.pid) === worker.started)
            await stopProcessGroup(worker.pid).catch(() => false);
        if (restart) {
          ledger.requestRestart();
          lifetime.successor(input);
        }
        lifetime.exit(restart ? 75 : 1);
      })();
    };
    owner = new ServiceOwner(lease, {
      faulted: () => {
        if (ready && !stopRequested) endAfterFault(true);
      },
      quiesce: () => http.quiesce(),
      flush: () => {
        if (!writer) throw new ContractError("unavailable");
        return writer.flush();
      },
      closeListener: async () => {
        workbench?.closeReads();
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
    const recoveryLog = new RecoveryLog(c.files);
    const history = await healHistory(lease, recoveryLog);
    if (
      history.heal === "continued-history" ||
      history.heal === "archived-history"
    )
      recoveryLog.record({
        scope: "project",
        path: c.store.root,
        cause: "storage",
        actions: [history.heal],
        workers: 0,
        archive: history.archive,
      });
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
      cwd: c.store.root,
      environment: launch,
    });
    const preferences = new CadencePreferences(input.config.agentDir);
    const choice = new OwnerModelChoice({
      owner,
      models,
      access,
      remember: (value) => preferences.save(value),
      recall: () => preferences.read(),
    });
    const { PI_OFFLINE: _offline, ...ordinary } = launch;
    const checkEnvironment = Object.freeze(ordinary);
    const gate = new CheckoutGate(owner);
    if (!sourceBuild?.deferRuntime)
      owner.registerRuntime(() => gate.closeAdmission(), {
        assertQuiescent: () => gate.assertQuiescent(),
      });
    // One complete, current literal source for every owner-facing projection.
    // Access material is deliberately excluded from the ordinary launch env.
    const ownerLiterals = () => [
      ...access.redactionLiterals(),
      native.capability,
      ...network.literals,
      ...models.viewRedactionLiterals(),
    ];
    workbench = !sourceBuild?.deferRuntime
      ? new Workbench({
          coordination: c,
          owner,
          models,
          choice,
          gate,
          cwd: input.config.cwd,
          agentDir: input.config.agentDir,
          projectsEnabled: !input.config.http.proxy,
          checkEnvironment,
          hostUrl: new URL(
            sourceBuild ? "../service-host.mjs" : "./service-host.mjs",
            import.meta.url,
          ),
          secrets: ownerLiterals,
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
            actions: !!workbench && !!choice.snapshot().selected,
            manualChecks: false,
            history: true,
          },
        };
      },
      workspace: () => {
        const before = ownerLiterals();
        const view = {
          rootLabel: diagnosticText(sanitizeText(c.store.root, before), 4096),
          models: models.observe(),
          context: unavailable(null),
        };
        if (canonicalJson(before) !== canonicalJson(ownerLiterals()))
          throw new ContractError("stale");
        return view;
      },
      context: (id) => unavailable(id),
      checks: () => ({ revision: 1, selections: [] }),
      legacyTasks: (budget) => {
        const before = ownerLiterals();
        // The retained projector uses only the legacy goal; never expose an old
        // human-readable summary as an unsanitized private-credential channel.
        const records = legacy(legacyTaskStore(c), budget, reader).map(
          (record) => ({
            ...record,
            goal: sanitizeText(record.goal, before),
          }),
        );
        if (canonicalJson(before) !== canonicalJson(ownerLiterals()))
          throw new ContractError("stale");
        return records;
      },
    });
    live = new HistoryLive(writer, projection);
    let stopRequested = false;
    http.configure({
      auth,
      build,
      adapters: {
        workbench: workbench ?? undefined,
        models: choice,
        modelChoice: workbench ? choice : undefined,
        current: {
          current: () => {
            throw new ContractError("unsupported-context");
          },
          currentChanges: () => {
            throw new ContractError("unsupported-context");
          },
          activeRuns: () => ({
            storeId: reader.storeId,
            workspaceId: reader.files.format.workspaceId,
            epoch: native.epoch,
            status: "complete",
            runs: [], // Retired task roster only; workflows have their own typed read.
          }),
        },
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
              // Accepted work its Stop would end; the WebUI names it before a restart.
              work: heldOwner.acceptedPending,
              actions:
                heldOwner.state === "idle" &&
                !!workbench &&
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
                    recovery: "automatic",
                  }
                : {}),
            };
          if (operation === "stop") {
            if (!stopRequested) {
              stopRequested = true;
              setImmediate(() => {
                void heldOwner
                  .stop()
                  .then(() => heldOwner.settled())
                  .then(() => {
                    if (heldOwner.state === "stopped") {
                      observeProcesses(undefined);
                      ledger.close();
                    } else endAfterFault(false);
                  })
                  .finally(() => {
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
      gate,
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
      // A registered owner that failed to start leaves nothing it cannot
      // explain: end the process so the next start heals its registration.
      if (lifetime) setTimeout(() => lifetime.exit(1), 500);
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
    throw new StartupRefusal(
      error instanceof ContractError ? error.code : "unavailable",
      stage,
      !!owner,
    );
  }
}
