/** Maintained portable codec source. Shared by ordinary JS workers and the service facade.
 * Public types live solely in worker-public.d.mts; the TS contract paths are re-export shims.
 * Initially relocated mechanically from W1 core/domain/capture; not a generated build output. */
/** Portable service boundary. No SDK objects, credentials, filesystem paths as IDs, or execution owner. */
export const SERVICE_PROTOCOL = 1;
export const WORKER_PROTOCOL = 2;
export const GRAPH_SCHEMA = "cadence-graph/2";
export const HISTORY_SCHEMA = "cadence-history/2";
export const EXPORT_SCHEMA = "cadence-public-export/2";
export const LIMITS = Object.freeze({
  controlBytes: 1024 * 1024,
  // Admission-owned encoded-data ceilings, including unresolved original waits.
  admissionCount: 16,
  admissionBytes: 32 * 1024 * 1024,
  cancelBytes: 64 * 1024,
  headerBytes: 8 * 1024,
  wsClientFrameBytes: 16 * 1024,
  startWaitMs: 10_000,
  stopWaitMs: 60_000,
  authWaitMs: 30_000,
  authValidityMarginMs: 120_000,
  browserLifetimeMs: 12 * 60 * 60 * 1000,
  terminateGraceMs: 1000,
  unconfirmedStopMs: 3000,
  graphBytes: 512 * 1024,
  grantMs: 120_000,
  assignments: 16,
  instructionsBytes: 16 * 1024,
  expectedOutputBytes: 2048,
  workerRequestBytes: 128 * 1024,
  publicRequestBytes: 96 * 1024,
  predecessorBytes: 16 * 1024,
  handoffBytes: 32 * 1024,
  frameBytes: 64 * 1024,
  chunkBytes: 8 * 1024,
  detailBytes: 32 * 1024 * 1024,
  childProtocolBytes: 128 * 1024 * 1024,
  dataFrames: 100_000,
  controlFrames: 256,
  sdkEvents: 1_000_000,
  workerQueueBytes: 4 * 1024 * 1024,
  workerQueueFrames: 1024,
  ownerQueueBytes: 8 * 1024 * 1024,
  ownerQueueFrames: 2048,
  // Transform queue headroom, not the separate per-episode disk reservation.
  ownerControlBytes: 1024 * 1024,
  ownerControlFrames: 256,
  recordingStallMs: 5000,
  episodes: 8,
  queuedAssignments: 128,
  childReservations: 2,
  episodeMs: 6 * 60 * 60 * 1000,
  readyWaitMs: 10 * 60 * 1000,
  workerMs: 1_200_000,
  artifactPartBytes: 256 * 1024,
  progressBatchMs: 100,
  progressBatchBytes: 256 * 1024,
  segmentBytes: 8 * 1024 * 1024,
  segmentRecords: 4096,
  checkoutQuotaBytes: 10 * 1024 * 1024 * 1024,
  episodeReservationBytes: 512 * 1024 * 1024,
  freeSpaceFloorBytes: 256 * 1024 * 1024,
  episodeControlBytes: 1024 * 1024,
  searchReaders: 2,
  exportReaders: 2,
  downloadIdleMs: 120_000,
  pageEntries: 50,
  maxPageEntries: 200,
  pageBytes: 512 * 1024,
  detailPageBytes: 256 * 1024,
  previewBytes: 4096,
  searchBytes: 8 * 1024 * 1024,
  searchMs: 100,
  queryBytes: 1024,
  navigationBytes: 8192,
  ringEvents: 1024,
  ringBytes: 2 * 1024 * 1024,
  viewers: 16,
  viewerMessages: 256,
  viewerBytes: 1024 * 1024,
  heartbeatMs: 5000,
  staleMs: 15_000,
  reconcileMs: 30_000,
});
export const ERROR_CODES = [
  "invalid",
  "oversize",
  "unauthenticated",
  "forbidden",
  "stale",
  "conflict",
  "corrupt-selected",
  "expired-grant",
  "consumed-grant",
  "unsupported-context",
  "quarantine",
  "capacity",
  "unavailable",
  "auth-unavailable",
  "recording-exhausted",
  "receipt-inconclusive",
];
export class ContractError extends Error {
  code;
  constructor(code = "invalid") {
    super(code);
    this.code = code;
  }
}
export function publicError(code, effect = "none") {
  return {
    code,
    effect,
    recovery:
      effect !== "none" || code === "receipt-inconclusive"
        ? "observe"
        : ["stale", "expired-grant", "consumed-grant"].includes(code)
          ? "fresh-confirmation"
          : "operator",
  };
}
export function errorStatus(code) {
  switch (code) {
    case "invalid":
      return 400;
    case "oversize":
      return 413;
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "stale":
    case "conflict":
    case "corrupt-selected":
    case "consumed-grant":
      return 409;
    case "expired-grant":
      return 410;
    case "unsupported-context":
      return 422;
    case "quarantine":
      return 423;
    case "capacity":
      return 429;
    case "recording-exhausted":
      return 507;
    default:
      return 503;
  }
}
export function invalid() {
  throw new ContractError();
}
export function text(v, max, nonempty = false) {
  if (
    typeof v !== "string" ||
    v.includes("\0") ||
    /[\uD800-\uDFFF]/u.test(v) ||
    (nonempty && !v.trim())
  )
    invalid();
  if (utf8Bytes(v) > max) throw new ContractError("oversize");
  return v;
}
export function utf8Bytes(v) {
  return new TextEncoder().encode(v).length;
}
export function integer(v, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    invalid();
  return v;
}
export function bool(v) {
  if (typeof v !== "boolean") invalid();
  return v;
}
export function oneOf(v, values) {
  if (typeof v !== "string" || !values.includes(v)) invalid();
  return v;
}
export function literal(v, expected) {
  if (v !== expected) invalid();
  return expected;
}
export function nullable(v, read) {
  return v === null ? null : read(v);
}
// Descriptor reads prevent accessors/toJSON from becoming implicit public-boundary effects.
export function closed(v, keys) {
  if (
    v === null ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(v))
  )
    invalid();
  const names = Reflect.ownKeys(v);
  if (
    names.length !== keys.length ||
    names.some((k) => typeof k !== "string" || !keys.includes(k))
  )
    invalid();
  const out = Object.create(null);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !("value" in d) || !d.enumerable) invalid();
    out[k] = d.value;
  }
  return out;
}
export function list(v, max, read) {
  if (
    !Array.isArray(v) ||
    v.length > max ||
    Reflect.ownKeys(v).length !== v.length + 1
  )
    invalid();
  const out = [];
  for (let i = 0; i < v.length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (!d || !("value" in d)) invalid();
    out.push(read(d.value));
  }
  return out;
}
export function decodeId(v) {
  const s = text(v, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      s,
    )
  )
    invalid();
  return s;
}
export function decodeHash(v) {
  const s = text(v, 64);
  if (!/^[0-9a-f]{64}$/.test(s)) invalid();
  return s;
}
export function decodeSequence(v) {
  const s = text(v, LIMITS.controlBytes);
  if (!/^(0|[1-9][0-9]*)$/.test(s)) invalid();
  return s;
}
export function compareSequence(a, b) {
  decodeSequence(a);
  decodeSequence(b);
  return a.length === b.length
    ? a === b
      ? 0
      : a < b
        ? -1
        : 1
    : a.length < b.length
      ? -1
      : 1;
}
export function assignmentId(v) {
  const s = text(v, 48);
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(s)) invalid();
  return s;
}
/** Deterministic identity of decoded credential-free DTOs; never use this on authentication data. */
export function canonicalJson(value, maximum = LIMITS.controlBytes) {
  let remaining = maximum;
  const charge = (s) => {
    remaining -= utf8Bytes(s);
    if (remaining < 0) throw new ContractError("oversize");
    return s;
  };
  function visit(v, depth) {
    if (depth > 64) invalid();
    if (v === null || typeof v === "boolean") return charge(String(v));
    if (typeof v === "string") {
      text(v, maximum);
      return charge(JSON.stringify(v));
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) invalid();
      return charge(JSON.stringify(v));
    }
    if (Array.isArray(v)) {
      const items = list(v, maximum, (x) => x);
      charge(`[]${",".repeat(Math.max(0, items.length - 1))}`);
      return `[${items.map((x) => visit(x, depth + 1)).join(",")}]`;
    }
    if (v && typeof v === "object") {
      const keys = Reflect.ownKeys(v);
      if (keys.some((k) => typeof k !== "string")) invalid();
      const names = keys.sort();
      const o = closed(v, names);
      charge(`{}${",".repeat(Math.max(0, names.length - 1))}`);
      return `{${names.map((k) => `${charge(`${JSON.stringify(k)}:`)}${visit(o[k], depth + 1)}`).join(",")}}`;
    }
    return invalid();
  }
  return visit(value, 0);
}
/** JSON.parse alone loses duplicate keys. All HTTP/worker text adapters must use this before a DTO decoder. */
export function parseWireJson(source, maximum = LIMITS.controlBytes) {
  text(source, maximum);
  let at = 0;
  const ws = () => {
    while (/[\x20\t\r\n]/.test(source[at] ?? "!")) at++;
  };
  function string() {
    const start = at++;
    let escaped = false;
    while (at < source.length) {
      const c = source[at++];
      if (!escaped && c === '"') {
        try {
          const s = JSON.parse(source.slice(start, at));
          return text(s, maximum);
        } catch {
          return invalid();
        }
      }
      if (!escaped && c === "\\") escaped = true;
      else escaped = false;
    }
    return invalid();
  }
  function value(depth) {
    if (depth > 64) invalid();
    ws();
    if (source[at] === '"') return string();
    if (source[at] === "{" || source[at] === "[") {
      const object = source[at++] === "{";
      const end = object ? "}" : "]";
      const out = Object.create(null);
      const arr = [];
      const keys = new Set();
      ws();
      if (source[at] === end) {
        at++;
        return object ? out : arr;
      }
      for (;;) {
        ws();
        let key = "";
        if (object) {
          if (source[at] !== '"') invalid();
          key = string();
          if (keys.has(key)) invalid();
          keys.add(key);
          ws();
          if (source[at++] !== ":") invalid();
        }
        const item = value(depth + 1);
        if (object) out[key] = item;
        else arr.push(item);
        ws();
        const c = source[at++];
        if (c === end) break;
        if (c !== ",") invalid();
      }
      return object ? out : arr;
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
        source.slice(at),
      )?.[0];
    if (!token) invalid();
    at += token.length;
    const result = JSON.parse(token);
    if (typeof result === "number" && !Number.isFinite(result)) invalid();
    return result;
  }
  const result = value(0);
  ws();
  if (at !== source.length) invalid();
  return result;
}
export function decodePublicError(v) {
  const o = closed(v, ["code", "effect", "recovery"]);
  return {
    code: oneOf(o.code, ERROR_CODES),
    effect: oneOf(o.effect, ["none", "accepted", "uncertain"]),
    recovery: oneOf(o.recovery, ["observe", "fresh-confirmation", "operator"]),
  };
}
export const fields = [
  "plan",
  "context",
  "message",
  "final-text",
  "tool-args",
  "tool-update",
  "tool-result",
  "check",
  "changes",
  "review",
];
export const outcomes = [
  "completed",
  "failed",
  "canceled",
  "timeout",
  "unknown",
  "blocked",
];
export const closures = ["not-launched", "direct-child-closed", "unconfirmed"];
export const modelApis = [
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "anthropic-messages",
  "google-generative-ai",
  "mistral-conversations",
  "azure-openai-responses",
];
// The pinned SDK's ThinkingLevel, including "max" (models whose
// thinkingLevelMap maps only max, such as some DeepSeek configurations).
export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
export function decodeModelSelector(v) {
  const o = closed(v, ["provider", "model", "api", "thinking"]);
  return {
    provider: text(o.provider, 128, true),
    model: text(o.model, 256, true),
    api: oneOf(o.api, modelApis),
    thinking: oneOf(o.thinking, thinkingLevels),
  };
}
export function decodeModelSelection(v) {
  const o = closed(v, [
    "sourceSelectionId",
    "provider",
    "model",
    "api",
    "thinking",
  ]);
  const { sourceSelectionId, ...selector } = o;
  return {
    sourceSelectionId: decodeId(sourceSelectionId),
    ...decodeModelSelector(selector),
  };
}
export function role(v) {
  const o = closed(v, ["role", "sha256"]);
  return {
    role: oneOf(o.role, [
      "design-explorer",
      "implementation-worker",
      "diagnosis-worker",
    ]),
    sha256: decodeHash(o.sha256),
  };
}
export function roleForPurpose(purpose) {
  return purpose === "edit"
    ? "implementation-worker"
    : purpose === "diagnosis"
      ? "diagnosis-worker"
      : "design-explorer";
}
export function decodeContentRef(v) {
  const o = closed(v, ["recordId", "version", "field", "bytes", "sha256"]);
  return {
    recordId: decodeId(o.recordId),
    version: integer(o.version, 1),
    field: oneOf(o.field, fields),
    bytes: integer(o.bytes, 0, LIMITS.detailBytes),
    sha256: decodeHash(o.sha256),
  };
}
export function range(v) {
  const o = closed(v, ["start", "end"]);
  const start = integer(o.start);
  return { start, end: integer(o.end, start + 1, LIMITS.detailBytes) };
}
export function dependency(v) {
  const o = closed(v, ["source", "range", "requireCompleteObservation"]);
  const kind = tag(o.source);
  let source;
  if (kind === "current") {
    const s = closed(o.source, ["kind", "assignmentId"]);
    source = { kind, assignmentId: assignmentId(s.assignmentId) };
  } else {
    const s = closed(o.source, ["kind", "runId", "childRunId", "result"]);
    literal(kind, "historical");
    const result = decodeContentRef(s.result);
    literal(result.field, "final-text");
    source = {
      kind: "historical",
      runId: decodeId(s.runId),
      childRunId: decodeId(s.childRunId),
      result,
    };
  }
  const selected = nullable(o.range, range);
  if (
    source.kind === "historical" &&
    selected &&
    selected.end > source.result.bytes
  )
    invalid();
  return {
    source,
    range: selected,
    requireCompleteObservation: bool(o.requireCompleteObservation),
  };
}
export function tag(v, key = "kind") {
  if (v === null || typeof v !== "object") invalid();
  const d = Object.getOwnPropertyDescriptor(v, key);
  if (!d || !("value" in d)) invalid();
  return text(d.value, 64, true);
}
export function decodeGraph(v) {
  canonicalJson(v, LIMITS.graphBytes);
  const o = closed(v, [
    "schema",
    "taskId",
    "taskKind",
    "taskRevision",
    "revision",
    "planRevision",
    "plan",
    "assignments",
  ]);
  const plan = decodeContentRef(o.plan);
  literal(plan.field, "plan");
  const planRevision = integer(o.planRevision, 1);
  if (plan.version !== planRevision) invalid();
  const graph = {
    schema: literal(o.schema, GRAPH_SCHEMA),
    taskId: decodeId(o.taskId),
    taskKind: oneOf(o.taskKind, ["code", "research", "diagnosis"]),
    taskRevision: integer(o.taskRevision, 1),
    revision: integer(o.revision, 1),
    planRevision,
    plan,
    assignments: list(o.assignments, LIMITS.assignments, (v) => {
      const a = closed(v, [
        "id",
        "purpose",
        "instructions",
        "expectedOutput",
        "role",
        "model",
        "dependencies",
      ]);
      return {
        id: assignmentId(a.id),
        purpose: oneOf(a.purpose, ["research", "diagnosis", "review", "edit"]),
        instructions: text(a.instructions, LIMITS.instructionsBytes, true),
        expectedOutput: text(
          a.expectedOutput,
          LIMITS.expectedOutputBytes,
          true,
        ),
        role: role(a.role),
        model: decodeModelSelection(a.model),
        dependencies: list(a.dependencies, LIMITS.assignments, dependency),
      };
    }),
  };
  if (!graph.assignments.length) invalid();
  const ids = new Map(graph.assignments.map((a) => [a.id, a]));
  if (ids.size !== graph.assignments.length) invalid();
  const visiting = new Set();
  const visited = new Set();
  function visit(a) {
    if (visiting.has(a.id)) invalid();
    if (visited.has(a.id)) return;
    visiting.add(a.id);
    const seen = new Set();
    for (const d of a.dependencies) {
      const key = canonicalJson(d.source);
      if (seen.has(key)) invalid();
      seen.add(key);
      if (d.source.kind === "current") {
        const prior = ids.get(d.source.assignmentId);
        if (!prior) invalid();
        visit(prior);
      }
    }
    visiting.delete(a.id);
    visited.add(a.id);
  }
  for (const a of graph.assignments) {
    if (graph.taskKind !== "code" && a.purpose === "edit")
      throw new ContractError("forbidden");
    if (a.role.role !== roleForPurpose(a.purpose))
      throw new ContractError("forbidden");
    visit(a);
  }
  return graph;
}
export function taskVersion(v) {
  const o = closed(v, [
    "id",
    "kind",
    "revision",
    "identity",
    "graphRevision",
    "graphIdentity",
  ]);
  const graphRevision = nullable(o.graphRevision, (v) => integer(v, 1));
  const graphIdentity = nullable(o.graphIdentity, decodeHash);
  if ((graphRevision === null) !== (graphIdentity === null)) invalid();
  return {
    id: decodeId(o.id),
    kind: oneOf(o.kind, ["code", "research", "diagnosis"]),
    revision: integer(o.revision, 1),
    identity: decodeHash(o.identity),
    graphRevision,
    graphIdentity,
  };
}
export function decodeContext(v) {
  const o = closed(v, [
    "epoch",
    "accessGeneration",
    "configRev",
    "controlRev",
    "workspaceId",
    "cwdId",
    "model",
    "checkEnvGeneration",
    "checkoutGeneration",
    "observation",
    "task",
  ]);
  const obs = closed(o.observation, ["identity", "complete"]);
  return {
    epoch: decodeId(o.epoch),
    accessGeneration: integer(o.accessGeneration, 1),
    configRev: integer(o.configRev, 1),
    controlRev: integer(o.controlRev, 1),
    workspaceId: decodeId(o.workspaceId),
    cwdId: decodeId(o.cwdId),
    model: decodeModelSelection(o.model),
    checkEnvGeneration: integer(o.checkEnvGeneration, 1),
    checkoutGeneration: integer(o.checkoutGeneration),
    observation: {
      identity: decodeHash(obs.identity),
      complete: bool(obs.complete),
    },
    task: nullable(o.task, taskVersion),
  };
}
export function checkSelection(v) {
  const o = closed(v, ["kind", "name", "command", "timeoutMs"]);
  const result = {
    kind: oneOf(o.kind, ["configured", "manual"]),
    name: text(o.name, 128, true),
    command: text(o.command, 4096, true),
    timeoutMs: integer(o.timeoutMs, 100, LIMITS.workerMs),
  };
  // Same visible-command policy as task-types; that legacy decoder uses Node Buffer and permits extra keys.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: executable confirmations must be visibly representable
  const controls = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u;
  if (
    controls.test(result.name) ||
    controls.test(result.command) ||
    /[\n\t]/.test(result.name) ||
    result.name === "Manual command"
  )
    invalid();
  if (
    result.kind === "manual" &&
    (result.name !== "Manual" || result.timeoutMs !== 120_000)
  )
    invalid();
  return result;
}
export function decodeAction(v) {
  canonicalJson(v);
  switch (tag(v)) {
    case "create": {
      const o = closed(v, ["kind", "taskKind", "goal"]);
      return {
        kind: "create",
        taskKind: oneOf(o.taskKind, ["code", "research", "diagnosis"]),
        goal: text(o.goal, 8192, true),
      };
    }
    case "save-plan": {
      const o = closed(v, ["kind", "taskId", "plan", "graph"]);
      const graph = decodeGraph(o.graph);
      const taskId = decodeId(o.taskId);
      if (graph.taskId !== taskId) invalid();
      return { kind: "save-plan", taskId, plan: text(o.plan, 32768), graph };
    }
    case "generate-plan":
    case "start": {
      const kind = tag(v);
      const o = closed(v, ["kind", "taskId"]);
      return { kind, taskId: decodeId(o.taskId) };
    }
    case "check": {
      const o = closed(v, ["kind", "taskId", "check"]);
      return {
        kind: "check",
        taskId: decodeId(o.taskId),
        check: checkSelection(o.check),
      };
    }
    case "review": {
      const o = closed(v, [
        "kind",
        "taskId",
        "runId",
        "changesIdentity",
        "checksRevision",
        "acceptIssues",
      ]);
      return {
        kind: "review",
        taskId: decodeId(o.taskId),
        runId: decodeId(o.runId),
        changesIdentity: decodeHash(o.changesIdentity),
        checksRevision: integer(o.checksRevision),
        acceptIssues: bool(o.acceptIssues),
      };
    }
    default:
      return invalid();
  }
}
export function decodePreflightRequest(v) {
  canonicalJson(v);
  const o = closed(v, ["expected", "action"]);
  return {
    expected: decodeContext(o.expected),
    action: decodeAction(o.action),
  };
}
export function decodeCommand(v) {
  canonicalJson(v);
  const o = closed(v, ["commandId", "grant", "expected", "action"]);
  return {
    commandId: decodeId(o.commandId),
    grant: decodeId(o.grant),
    expected: decodeContext(o.expected),
    action: decodeAction(o.action),
  };
}
export function decodeCommandIdentity(v) {
  canonicalJson(v);
  if (tag(v) === "action") {
    const o = closed(v, ["kind", "expected", "action"]);
    return {
      kind: "action",
      expected: decodeContext(o.expected),
      action: decodeAction(o.action),
    };
  }
  const o = closed(v, ["kind", "epoch", "runId"]);
  literal(o.kind, "cancel");
  return { kind: "cancel", epoch: decodeId(o.epoch), runId: decodeId(o.runId) };
}
export function decodeCancel(v) {
  const o = closed(v, ["commandId", "epoch", "runId"]);
  return {
    commandId: decodeId(o.commandId),
    epoch: decodeId(o.epoch),
    runId: decodeId(o.runId),
  };
}
export function decodePreview(v) {
  canonicalJson(v);
  const hasCheckPolicy =
    typeof v === "object" &&
    v !== null &&
    Object.hasOwn(v, "checkEnvironmentPolicy");
  const o = closed(v, [
    "version",
    "action",
    "rootLabel",
    "cwdLabel",
    "readablePlan",
    "graph",
    "activeRunId",
    "issues",
    "configuredChecks",
    "checksRevision",
    "reviewRunId",
    ...(hasCheckPolicy ? ["checkEnvironmentPolicy"] : []),
  ]);
  const configuredChecks = list(o.configuredChecks, 32, checkSelection);
  if (
    configuredChecks.some((check) => check.kind !== "configured") ||
    new Set(configuredChecks.map((check) => check.name)).size !==
      configuredChecks.length
  )
    invalid();
  return {
    ...(hasCheckPolicy
      ? {
          checkEnvironmentPolicy: literal(
            o.checkEnvironmentPolicy,
            "service-launch-ordinary/1",
          ),
        }
      : {}),
    configuredChecks,
    checksRevision: integer(o.checksRevision),
    reviewRunId: nullable(o.reviewRunId, decodeId),
    version: decodeContext(o.version),
    action: decodeAction(o.action),
    rootLabel: text(o.rootLabel, 4096, true),
    cwdLabel: text(o.cwdLabel, 4096, true),
    readablePlan: text(o.readablePlan, 32768),
    graph: nullable(o.graph, decodeGraph),
    activeRunId: nullable(o.activeRunId, decodeId),
    issues: list(o.issues, 7, (v) =>
      oneOf(v, [
        "incomplete-observation",
        "unrun-checks",
        "stale-checks",
        "failed-checks",
        "partial-results",
        "recording-incomplete",
        "legacy-context",
      ]),
    ),
  };
}
export function decodePreflight(v) {
  canonicalJson(v);
  const o = closed(v, ["grant", "expiresAt", "preview"]);
  const expiresAt = text(o.expiresAt, 24);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(expiresAt) ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    new Date(expiresAt).toISOString() !== expiresAt
  )
    invalid();
  return {
    grant: decodeId(o.grant),
    expiresAt,
    preview: decodePreview(o.preview),
  };
}
export function decodeCoverage(v) {
  const o = closed(v, ["observed", "source", "redacted", "omissions"]);
  const result = {
    observed: oneOf(o.observed, ["complete", "incomplete"]),
    source: oneOf(o.source, ["complete", "limited", "unavailable"]),
    redacted: bool(o.redacted),
    omissions: list(o.omissions, 6, (v) =>
      oneOf(v, [
        "binary",
        "hidden-thinking",
        "source-limit",
        "capture-limit",
        "gap",
        "unsupported",
      ]),
    ),
  };
  if (
    new Set(result.omissions).size !== result.omissions.length ||
    (result.observed === "complete" &&
      result.omissions.some((x) => x === "capture-limit" || x === "gap"))
  )
    invalid();
  return result;
}
export function decodeHandoff(v) {
  const o = closed(v, ["graphRevision", "inputs"]);
  let total = 0;
  const seen = new Set();
  return {
    graphRevision: integer(o.graphRevision, 1),
    inputs: list(o.inputs, LIMITS.assignments, (v) => {
      const i = closed(v, [
        "assignmentId",
        "dependencyIndex",
        "runId",
        "childRunId",
        "result",
        "range",
        "text",
        "coverage",
      ]);
      const result = decodeContentRef(i.result);
      literal(result.field, "final-text");
      const selected = nullable(i.range, range);
      if (selected && selected.end > result.bytes) invalid();
      const supplied = text(i.text, LIMITS.predecessorBytes);
      total += utf8Bytes(supplied);
      if (total > LIMITS.handoffBytes) throw new ContractError("oversize");
      const dependencyIndex = integer(
        i.dependencyIndex,
        0,
        LIMITS.assignments - 1,
      );
      if (seen.has(dependencyIndex)) invalid();
      seen.add(dependencyIndex);
      // Range is in the committed sanitized source, not raw wire data. No clipping/synthesis allowed.
      if (
        utf8Bytes(supplied) !==
        (selected ? selected.end - selected.start : result.bytes)
      )
        invalid();
      return {
        assignmentId: assignmentId(i.assignmentId),
        dependencyIndex,
        runId: decodeId(i.runId),
        childRunId: decodeId(i.childRunId),
        result,
        range: selected,
        text: supplied,
        coverage: decodeCoverage(i.coverage),
      };
    }),
  };
}
export function decodeWorkerPublicRequest(v) {
  canonicalJson(v, LIMITS.publicRequestBytes);
  const o = closed(v, [
    "protocol",
    "taskId",
    "taskKind",
    "runId",
    "childRunId",
    "assignmentId",
    "purpose",
    "model",
    "role",
    "context",
    "instructions",
    "prompt",
    "handoff",
  ]);
  const result = {
    protocol: literal(o.protocol, WORKER_PROTOCOL),
    taskId: decodeId(o.taskId),
    taskKind: oneOf(o.taskKind, ["code", "research", "diagnosis"]),
    runId: decodeId(o.runId),
    childRunId: decodeId(o.childRunId),
    assignmentId: assignmentId(o.assignmentId),
    purpose: oneOf(o.purpose, ["research", "diagnosis", "review", "edit"]),
    model: decodeModelSelection(o.model),
    role: role(o.role),
    context: text(o.context, 32768),
    instructions: text(o.instructions, LIMITS.instructionsBytes, true),
    prompt: text(o.prompt, 32768, true),
    handoff: decodeHandoff(o.handoff),
  };
  if (result.handoff.inputs.some((i) => i.assignmentId !== result.assignmentId))
    invalid();
  if (
    (result.taskKind !== "code" && result.purpose === "edit") ||
    result.role.role !== roleForPurpose(result.purpose)
  )
    throw new ContractError("forbidden");
  return result;
}
/** Enforce on the actual serialized anonymous-stdin envelope AFTER owner-only auth insertion. Never log/return it. */
export function assertWorkerEnvelopeSize(serialized) {
  if (utf8Bytes(serialized) > LIMITS.workerRequestBytes)
    throw new ContractError("oversize");
}
export function decodeNativeSettlement(v) {
  const o = closed(v, [
    "outcome",
    "closure",
    "exitCode",
    "signal",
    "durationMs",
    "stdin",
    "final",
    "cleanup",
    "capture",
  ]);
  const r = {
    outcome: oneOf(o.outcome, [
      "completed",
      "failed",
      "canceled",
      "timeout",
      "unknown",
    ]),
    closure: oneOf(o.closure, closures),
    // Windows reports DWORD exit statuses (including native exception codes).
    // Retain the observed number rather than truncating/sign-coercing it.
    exitCode: nullable(o.exitCode, (v) => integer(v, -2147483648, 4294967295)),
    signal: nullable(o.signal, (v) => text(v, 32, true)),
    durationMs: integer(o.durationMs),
    stdin: oneOf(o.stdin, ["delivered", "failed", "not-required"]),
    final: oneOf(o.final, ["valid", "missing", "invalid"]),
    cleanup: oneOf(o.cleanup, ["settled", "failed", "unconfirmed"]),
    capture: decodeCoverage(o.capture),
  };
  if (
    r.closure === "not-launched" &&
    (r.exitCode !== null || r.signal !== null)
  )
    invalid();
  if (
    r.outcome === "completed" &&
    (r.closure !== "direct-child-closed" ||
      r.exitCode !== 0 ||
      r.signal !== null ||
      r.stdin !== "delivered" ||
      r.final !== "valid" ||
      r.cleanup !== "settled" ||
      r.capture.observed !== "complete")
  )
    invalid();
  return r;
}
export function decodeScope(v) {
  const o = closed(v, ["kind", "id"]);
  return { kind: oneOf(o.kind, ["task", "run", "child"]), id: decodeId(o.id) };
}
/** Opaque structural bound only. History authenticates progress after access checks. */
export function decodeNavigation(v) {
  const value = text(v, LIMITS.navigationBytes, true);
  if (!/^[\x21-\x7e]+$/.test(value)) invalid();
  return value;
}
export function decodeCursor(v) {
  canonicalJson(v);
  const o = closed(v, [
    "storeId",
    "scope",
    "query",
    "snapshotSeq",
    "recordId",
    "recordVersion",
    "field",
    "offset",
    ...(Object.hasOwn(v ?? {}, "navigation") ? ["navigation"] : []),
  ]);
  const r = {
    storeId: decodeId(o.storeId),
    scope: decodeScope(o.scope),
    query: nullable(o.query, (v) => {
      const q = text(v, LIMITS.queryBytes);
      if (!q.length) invalid();
      return q;
    }),
    snapshotSeq: decodeSequence(o.snapshotSeq),
    recordId: nullable(o.recordId, decodeId),
    recordVersion: nullable(o.recordVersion, (v) => integer(v, 1)),
    field: nullable(o.field, (v) => oneOf(v, fields)),
    offset: integer(o.offset),
    ...(Object.hasOwn(o, "navigation")
      ? { navigation: decodeNavigation(o.navigation) }
      : {}),
  };
  if (
    (r.recordId === null) !== (r.recordVersion === null) ||
    (r.recordId === null) !== (r.field === null)
  )
    invalid();
  return r;
}
export function decodeSourceIdentity(v) {
  const o = closed(v, ["disposition", "value"]);
  const disposition = oneOf(o.disposition, [
    "observed",
    "unavailable",
    "redacted",
  ]);
  const value = sourceId(o.value);
  if ((disposition === "observed") !== (value !== null)) invalid();
  return { disposition, value };
}
export function callLink(v) {
  const o = closed(v, ["messageId", "blockId"]);
  return { messageId: decodeId(o.messageId), blockId: decodeId(o.blockId) };
}
export function decodeContentOwner(v) {
  const kind = tag(v);
  if (kind === "message-final") {
    const o = closed(v, ["kind", "messageId"]);
    return { kind, messageId: decodeId(o.messageId) };
  }
  if (kind === "context") {
    const o = closed(v, ["kind", "component"]);
    return {
      kind,
      component: oneOf(o.component, [
        "request-context",
        "request-prompt",
        "request-instructions",
        "role",
        "effective-system",
      ]),
    };
  }
  if (kind === "handoff") {
    const o = closed(v, ["kind", "dependencyIndex", "source"]);
    const source = decodeContentRef(o.source);
    literal(source.field, "final-text");
    return {
      kind,
      dependencyIndex: integer(o.dependencyIndex, 0, LIMITS.assignments - 1),
      source,
    };
  }
  if (kind === "message") {
    const o = closed(v, ["kind", "messageId", "blockId", "index", "stage"]);
    return {
      kind,
      messageId: decodeId(o.messageId),
      blockId: decodeId(o.blockId),
      index: integer(o.index, 0, LIMITS.dataFrames),
      stage: oneOf(o.stage, ["stream", "final"]),
    };
  }
  const o = closed(v, ["kind", "callId", "blockId", "index", "stage"]);
  literal(kind, "tool");
  return {
    kind: "tool",
    callId: decodeId(o.callId),
    blockId: decodeId(o.blockId),
    index: integer(o.index, 0, LIMITS.dataFrames),
    stage: oneOf(o.stage, [
      "arguments-partial",
      "arguments-final",
      "execution-arguments",
      "update-snapshot",
      "result",
    ]),
  };
}
export function decodeDetailDescriptor(v) {
  const o = closed(v, ["owner", "field", "encoding"]);
  const owner = decodeContentOwner(o.owner);
  const field = oneOf(o.field, [
    "context",
    "message",
    "final-text",
    "tool-args",
    "tool-update",
    "tool-result",
  ]);
  const encoding = oneOf(o.encoding, ["utf8", "canonical-json"]);
  const expected =
    owner.kind === "context" || owner.kind === "handoff"
      ? "context"
      : owner.kind === "message-final"
        ? "final-text"
        : owner.kind === "message"
          ? "message"
          : owner.stage === "result"
            ? "tool-result"
            : owner.stage === "update-snapshot"
              ? "tool-update"
              : "tool-args";
  if (
    field !== expected ||
    (owner.kind !== "tool" && encoding !== "utf8") ||
    (field === "tool-args" &&
      encoding !== "canonical-json" &&
      !(owner.kind === "tool" && owner.stage === "arguments-partial"))
  )
    invalid();
  // JSON bodies are sanitized canonical ordinary tool data, rendered as data;
  // they are NOT an additional object/protocol interpreted by readers.
  return { owner, field, encoding };
}
export function decodeOmittedBlock(v) {
  const o = closed(v, ["owner", "sourceType", "mimeType", "reason"]);
  const sourceType = oneOf(o.sourceType, [
    "image",
    "audio",
    "binary",
    "hidden-thinking",
    "unsupported",
  ]);
  const reason = oneOf(o.reason, ["binary", "hidden-thinking", "unsupported"]);
  const mimeType = nullable(o.mimeType, (v) => text(v, 128, true));
  if (
    reason !==
      (sourceType === "hidden-thinking"
        ? "hidden-thinking"
        : sourceType === "unsupported"
          ? "unsupported"
          : "binary") ||
    (mimeType !== null &&
      (sourceType === "hidden-thinking" ||
        !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)))
  )
    invalid();
  return { owner: decodeContentOwner(o.owner), sourceType, mimeType, reason };
}
function sourceId(v) {
  if (v === null) return null;
  const s = text(v, 128, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) invalid();
  return s;
}
export function decodeCaptureEvent(v) {
  const kind = tag(v);
  switch (kind) {
    case "ready": {
      const o = closed(v, ["kind", "requestProtocol"]);
      return {
        kind,
        requestProtocol: literal(o.requestProtocol, WORKER_PROTOCOL),
      };
    }
    case "message-start": {
      const o = closed(v, [
        "kind",
        "messageId",
        "role",
        "source",
        "resultCallId",
      ]);
      const role = oneOf(o.role, ["user", "assistant", "tool-result"]);
      const resultCallId = nullable(o.resultCallId, decodeId);
      if (role !== "tool-result" && resultCallId !== null) invalid();
      return {
        kind,
        messageId: decodeId(o.messageId),
        role,
        source: decodeSourceIdentity(o.source),
        resultCallId,
      };
    }
    case "message-text": {
      const o = closed(v, ["kind", "messageId", "blockId", "detailId"]);
      return {
        kind,
        ...callLink({ messageId: o.messageId, blockId: o.blockId }),
        detailId: decodeId(o.detailId),
      };
    }
    case "message-end": {
      const o = closed(v, [
        "kind",
        "messageId",
        "finalDetailId",
        "finalBlockCount",
        "stopReason",
      ]);
      return {
        kind,
        messageId: decodeId(o.messageId),
        finalDetailId: nullable(o.finalDetailId, decodeId),
        finalBlockCount: integer(o.finalBlockCount, 0, LIMITS.dataFrames),
        stopReason: oneOf(o.stopReason, [
          "stop",
          "length",
          "toolUse",
          "error",
          "aborted",
          "unknown",
        ]),
      };
    }
    case "call-declaration": {
      const o = closed(v, [
        "kind",
        "callId",
        "declaration",
        "index",
        "source",
        "name",
        "argsDetailId",
        "stage",
      ]);
      return {
        kind,
        callId: decodeId(o.callId),
        declaration: callLink(o.declaration),
        index: integer(o.index, 0, LIMITS.dataFrames),
        source: decodeSourceIdentity(o.source),
        name: text(o.name, 128, true),
        argsDetailId: nullable(o.argsDetailId, decodeId),
        stage: oneOf(o.stage, ["partial", "final"]),
      };
    }
    case "tool-start": {
      const o = closed(v, [
        "kind",
        "callId",
        "declaration",
        "source",
        "name",
        "argsDetailId",
      ]);
      return {
        kind,
        callId: decodeId(o.callId),
        declaration: nullable(o.declaration, callLink),
        source: decodeSourceIdentity(o.source),
        name: text(o.name, 128, true),
        argsDetailId: nullable(o.argsDetailId, decodeId),
      };
    }
    case "tool-update": {
      const o = closed(v, ["kind", "callId", "detailId", "semantics"]);
      return {
        kind,
        callId: decodeId(o.callId),
        detailId: decodeId(o.detailId),
        semantics: literal(o.semantics, "snapshot"),
      };
    }
    case "tool-end": {
      const o = closed(v, [
        "kind",
        "callId",
        "declaration",
        "source",
        "name",
        "resultDetailId",
        "isError",
        "association",
        "startObserved",
      ]);
      const association = oneOf(o.association, [
        "declared",
        "execution-only",
        "orphan",
        "ambiguous",
      ]);
      const declaration = nullable(o.declaration, callLink);
      const startObserved = bool(o.startObserved);
      if (
        (association === "declared") !== (declaration !== null) ||
        (association === "execution-only" && !startObserved) ||
        ((association === "orphan" || association === "ambiguous") &&
          startObserved)
      )
        invalid();
      return {
        kind,
        callId: decodeId(o.callId),
        declaration,
        source: decodeSourceIdentity(o.source),
        name: text(o.name, 128, true),
        resultDetailId: decodeId(o.resultDetailId),
        isError: bool(o.isError),
        association,
        startObserved,
      };
    }
    case "omitted-block": {
      const o = closed(v, ["kind", "block"]);
      return { kind, block: decodeOmittedBlock(o.block) };
    }
    case "detail-begin": {
      const o = closed(v, ["kind", "detailId", "descriptor"]);
      return {
        kind,
        detailId: decodeId(o.detailId),
        descriptor: decodeDetailDescriptor(o.descriptor),
      };
    }
    case "detail-chunk": {
      const o = closed(v, ["kind", "detailId", "offset", "text"]);
      const chunk = text(o.text, LIMITS.chunkBytes);
      const offset = integer(o.offset, 0, LIMITS.detailBytes);
      if (offset + utf8Bytes(chunk) > LIMITS.detailBytes) invalid();
      return { kind, detailId: decodeId(o.detailId), offset, text: chunk };
    }
    case "detail-end": {
      const o = closed(v, ["kind", "detailId", "bytes", "sha256", "coverage"]);
      return {
        kind,
        detailId: decodeId(o.detailId),
        bytes: integer(o.bytes, 0, LIMITS.detailBytes),
        sha256: decodeHash(o.sha256),
        coverage: decodeCoverage(o.coverage),
      };
    }
    case "capture-status": {
      const o = closed(v, ["kind", "coverage"]);
      return { kind, coverage: decodeCoverage(o.coverage) };
    }
    case "worker-failure": {
      const o = closed(v, ["kind", "code"]);
      return {
        kind,
        code: oneOf(o.code, [
          "protocol",
          "capture",
          "model",
          "auth",
          "network",
          "cleanup",
          "prompt",
        ]),
      };
    }
    case "final": {
      const o = closed(v, ["kind", "messageId", "detailId", "stopReason"]);
      return {
        kind,
        messageId: decodeId(o.messageId),
        detailId: decodeId(o.detailId),
        stopReason: literal(o.stopReason, "stop"),
      };
    }
    default:
      return invalid();
  }
}
export function decodeCaptureFrame(v) {
  canonicalJson(v, LIMITS.frameBytes);
  const o = closed(v, [
    "protocol",
    "childRunId",
    "workerSeq",
    "observedMs",
    "event",
  ]);
  return {
    protocol: literal(o.protocol, WORKER_PROTOCOL),
    childRunId: decodeId(o.childRunId),
    workerSeq: integer(
      o.workerSeq,
      1,
      LIMITS.dataFrames + LIMITS.controlFrames,
    ),
    observedMs: integer(o.observedMs),
    event: decodeCaptureEvent(o.event),
  };
}
/** Header ordering only; W2 must additionally verify detail associations, hashes,
 * control/data totals and native settlement. A final frame is never native success. */
export function advanceCapture(position, input) {
  const frame = decodeCaptureFrame(input);
  if (
    position.final ||
    frame.childRunId !== position.childRunId ||
    frame.workerSeq !== position.workerSeq + 1 ||
    frame.observedMs < position.observedMs ||
    (frame.event.kind === "ready") !== (position.workerSeq === 0)
  )
    invalid();
  return {
    frame,
    position: {
      childRunId: frame.childRunId,
      workerSeq: frame.workerSeq,
      observedMs: frame.observedMs,
      final: frame.event.kind === "final",
    },
  };
}
export function decodeCheckNativeSettlement(v) {
  const o = closed(v, [
    "outcome",
    "closure",
    "exitCode",
    "signal",
    "durationMs",
    "stdin",
  ]);
  const r = {
    outcome: oneOf(o.outcome, [
      "completed",
      "failed",
      "canceled",
      "timeout",
      "unknown",
    ]),
    closure: oneOf(o.closure, closures),
    exitCode: nullable(o.exitCode, (v) => integer(v, -2147483648, 4294967295)),
    signal: nullable(o.signal, (v) => text(v, 32, true)),
    durationMs: integer(o.durationMs),
    stdin: literal(o.stdin, "not-required"),
  };
  if (
    (r.closure === "not-launched" &&
      (r.exitCode !== null || r.signal !== null)) ||
    (r.outcome === "completed" &&
      (r.closure !== "direct-child-closed" ||
        r.exitCode !== 0 ||
        r.signal !== null))
  )
    invalid();
  return r;
}
export function decodeFinalSelection(v) {
  const o = closed(v, ["messageId", "detailId"]);
  return { messageId: decodeId(o.messageId), detailId: decodeId(o.detailId) };
}
export function decodeDetailCommit(v) {
  const o = closed(v, ["childRunId", "detailId", "content", "committedSeq"]);
  const committedSeq = decodeSequence(o.committedSeq);
  if (committedSeq === "0") invalid();
  return {
    childRunId: decodeId(o.childRunId),
    detailId: decodeId(o.detailId),
    content: decodeContentRef(o.content),
    committedSeq,
  };
}
export function decodeFinalRecording(v) {
  const status = tag(v, "status");
  if (status === "committed") {
    const o = closed(v, ["status", "selected", "detail"]);
    const selected = decodeFinalSelection(o.selected),
      detail = decodeDetailCommit(o.detail);
    if (
      selected.detailId !== detail.detailId ||
      detail.content.field !== "final-text"
    )
      invalid();
    return { status, selected, detail };
  }
  if (status === "refused") {
    const o = closed(v, ["status", "selected", "error"]);
    return {
      status,
      selected: nullable(o.selected, decodeFinalSelection),
      error: decodePublicError(o.error),
    };
  }
  const o = closed(v, ["status", "selected"]);
  return {
    status: oneOf(status, ["pending", "uncertain"]),
    selected: nullable(o.selected, decodeFinalSelection),
  };
}
function decodeSettlementSeq(v, recording) {
  const seq = nullable(v, decodeSequence);
  if (
    seq === "0" ||
    (seq !== null &&
      recording.status === "committed" &&
      compareSequence(seq, recording.detail.committedSeq) < 0)
  )
    invalid();
  return seq;
}
export function childSatisfied(child) {
  return (
    child.native?.outcome === "completed" &&
    child.recording.status === "committed" &&
    child.settlementSeq !== null
  );
}
export function settlementOutcome(s) {
  if (s.kind === "parent") return s.outcome;
  if (s.native.outcome !== "completed") return s.native.outcome;
  return s.kind === "sdk"
    ? childSatisfied(s)
      ? "completed"
      : "failed"
    : s.capture.observed === "complete" && s.settlementSeq !== null
      ? "completed"
      : "failed";
}
export function decodeRunSettlement(v) {
  const kind = tag(v);
  if (kind === "sdk") {
    const o = closed(v, ["kind", "native", "recording", "settlementSeq"]);
    const recording = decodeFinalRecording(o.recording),
      settlementSeq = decodeSettlementSeq(o.settlementSeq, recording);
    return {
      kind,
      native: decodeNativeSettlement(o.native),
      recording,
      settlementSeq,
    };
  }
  if (kind === "check") {
    const o = closed(v, ["kind", "native", "capture", "settlementSeq"]);
    const settlementSeq = nullable(o.settlementSeq, decodeSequence);
    if (settlementSeq === "0") invalid();
    return {
      kind,
      native: decodeCheckNativeSettlement(o.native),
      capture: decodeCoverage(o.capture),
      settlementSeq,
    };
  }
  const o = closed(v, ["kind", "outcome", "required"]);
  literal(kind, "parent");
  const required = list(o.required, LIMITS.assignments, (v) => {
    const c = closed(v, [
      "assignmentId",
      "childRunId",
      "native",
      "recording",
      "settlementSeq",
    ]);
    const childRunId = decodeId(c.childRunId),
      recording = decodeFinalRecording(c.recording);
    if (
      recording.status === "committed" &&
      recording.detail.childRunId !== childRunId
    )
      invalid();
    return {
      assignmentId: assignmentId(c.assignmentId),
      childRunId,
      native: nullable(c.native, decodeNativeSettlement),
      recording,
      settlementSeq: decodeSettlementSeq(c.settlementSeq, recording),
    };
  });
  const outcome = oneOf(o.outcome, outcomes);
  if (
    !required.length ||
    new Set(required.map((c) => c.assignmentId)).size !== required.length ||
    new Set(required.map((c) => c.childRunId)).size !== required.length ||
    (outcome === "completed" && !required.every(childSatisfied))
  )
    invalid();
  // W4 resolves this exact required set against frozen graph, not merely the
  // completed subset. No process, exit code or descendant claim belongs to parent.
  return { kind: "parent", outcome, required };
}
export function decodeWorkerCompletion(v) {
  const o = closed(v, ["childRunId", "native", "selected", "recording"]);
  const r = {
    childRunId: decodeId(o.childRunId),
    native: decodeNativeSettlement(o.native),
    selected: nullable(o.selected, decodeFinalSelection),
    recording: decodeFinalRecording(o.recording),
  };
  if (
    (r.native.final === "valid") !== (r.selected !== null) ||
    canonicalJson(r.selected) !== canonicalJson(r.recording.selected) ||
    (r.recording.status === "committed" &&
      r.recording.detail.childRunId !== r.childRunId)
  )
    invalid();
  return r;
}
export function decodeSourceRange(v) {
  const o = closed(v, ["first", "last", "firstObservedMs", "lastObservedMs"]);
  const first = integer(o.first, 1, LIMITS.dataFrames + LIMITS.controlFrames);
  const last = integer(o.last, first, LIMITS.dataFrames + LIMITS.controlFrames);
  const firstObservedMs = integer(o.firstObservedMs);
  const lastObservedMs = integer(o.lastObservedMs, firstObservedMs);
  if (first === last && firstObservedMs !== lastObservedMs) invalid();
  return { first, last, firstObservedMs, lastObservedMs };
}
export function decodeRecordingEvent(v) {
  const o = closed(v, ["source", "event"]);
  const source = decodeSourceRange(o.source);
  const kind = tag(o.event);
  if (kind === "stored-chunk") {
    const e = closed(o.event, ["kind", "detailId", "text"]);
    return {
      source,
      event: {
        kind,
        detailId: decodeId(e.detailId),
        text: text(e.text, LIMITS.chunkBytes),
      },
    };
  }
  if (kind === "stored-end") {
    const e = closed(o.event, ["kind", "detailId", "coverage"]);
    return {
      source,
      event: {
        kind,
        detailId: decodeId(e.detailId),
        coverage: decodeCoverage(e.coverage),
      },
    };
  }
  const event = decodeCaptureEvent(o.event);
  if (event.kind === "detail-chunk" || event.kind === "detail-end") invalid();
  return { source, event };
}
export function decodeRecordingLink(v) {
  const o = closed(v, ["epoch", "taskId", "runId", "childRunId"]);
  return {
    epoch: decodeId(o.epoch),
    taskId: decodeId(o.taskId),
    runId: decodeId(o.runId),
    childRunId: decodeId(o.childRunId),
  };
}
export function decodeRecordingInput(v) {
  canonicalJson(v, LIMITS.ownerQueueBytes);
  const o = closed(v, ["link", "source", "events"]);
  const source = decodeSourceRange(o.source),
    events = list(o.events, LIMITS.ownerQueueFrames, decodeRecordingEvent);
  if (
    events.some(
      (e) =>
        e.source.first < source.first ||
        e.source.last > source.last ||
        e.source.firstObservedMs < source.firstObservedMs ||
        e.source.lastObservedMs > source.lastObservedMs,
    )
  )
    invalid();
  return { link: decodeRecordingLink(o.link), source, events };
}
export function decodeCaptureBudget(v) {
  const o = closed(v, [
    "sourceFrames",
    "retainedBytes",
    "outputBytes",
    "outputChunks",
    "lane",
  ]);
  const r = {
    sourceFrames: integer(o.sourceFrames, 0, LIMITS.ownerQueueFrames),
    retainedBytes: integer(o.retainedBytes, 0, LIMITS.ownerQueueBytes),
    outputBytes: integer(o.outputBytes, 0, LIMITS.ownerQueueBytes),
    outputChunks: integer(o.outputChunks, 0, LIMITS.ownerQueueFrames),
    lane: oneOf(o.lane, ["data", "control"]),
  };
  if (
    r.retainedBytes + r.outputBytes > LIMITS.ownerQueueBytes ||
    (!r.sourceFrames && !r.retainedBytes && !r.outputBytes && !r.outputChunks)
  )
    invalid();
  return r;
}
export function decodeCommittedBatch(v) {
  const o = closed(v, ["committedSeq", "details", "ownerDetails", "coverage"]);
  const committedSeq = decodeSequence(o.committedSeq),
    details = list(o.details, LIMITS.ownerQueueFrames, decodeDetailCommit);
  if (
    committedSeq === "0" ||
    details.some((d) => compareSequence(d.committedSeq, committedSeq) > 0) ||
    new Set(details.map((d) => `${d.childRunId}/${d.detailId}`)).size !==
      details.length
  )
    invalid();
  const ownerDetails = list(o.ownerDetails, LIMITS.ownerQueueFrames, (v) => {
    const d = closed(v, ["operationId", "detailId", "content", "committedSeq"]),
      seq = decodeSequence(d.committedSeq);
    if (seq === "0" || compareSequence(seq, committedSeq) > 0) invalid();
    return {
      operationId: decodeId(d.operationId),
      detailId: decodeId(d.detailId),
      content: decodeContentRef(d.content),
      committedSeq: seq,
    };
  });
  if (
    new Set(ownerDetails.map((d) => `${d.operationId}/${d.detailId}`)).size !==
    ownerDetails.length
  )
    invalid();
  return {
    committedSeq,
    details,
    ownerDetails,
    coverage: decodeCoverage(o.coverage),
  };
}
