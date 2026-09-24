import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical.ts";
import { acquirePackageState } from "../src/package-state.ts";
import { RunStore } from "../src/run-store.ts";
import { resolveStateRoot } from "../src/state-root.ts";
import { discoverTasks, importTask } from "../src/task-import.ts";
import {
  type PublicationBoundary,
  TaskPublisher,
} from "../src/task-publication.ts";
import {
  decodePortableTask,
  newPortableTask,
  parsePortableTask,
  TASK_LIMITS,
  taskArtifactPath,
  taskHash,
  taskPublicationPath,
} from "../src/task-records.ts";
import { TaskStore } from "../src/task-store.ts";

const roots: string[] = [],
  stores: TaskStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-task-"));
  roots.push(root);
  const consumerRoot = path.join(root, "project");
  mkdirSync(consumerRoot);
  const state = resolveStateRoot({
    consumerRoot,
    xdgStateHome: path.join(root, "private"),
  });
  return { root, state, consumerRoot };
}
function open(state: ReturnType<typeof resolveStateRoot>) {
  const store = TaskStore.open(state);
  stores.push(store);
  return store;
}
const b = (value: string) => Buffer.from(value);
function seed() {
  const f = fixture();
  const store = open(f.state);
  const task = store.create("Small task");
  const relative = `.cadence/tasks/${task.id}/brief.md`;
  return {
    ...f,
    store,
    task,
    relative,
    target: path.join(f.consumerRoot, relative),
    publisher: new TaskPublisher(store),
  };
}
function child(script: string) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 20_000 },
  );
}
const storeUrl = pathToFileURL(path.resolve("src/task-store.ts")).href;

it("round-trips compact records and retains only explicitly selected narrative", () => {
  const raw = {
    ...newPortableTask("Readable title", "code", "compact"),
    latestSummary: [
      {
        statement: "Agreed scope",
        source: { kind: "user-summary", reference: "decision:1" },
      },
    ],
  };
  const record = parsePortableTask(b(canonicalJson(raw)));
  expect(record).toEqual(raw);
  expect(canonicalJson(record)).not.toContain("SENTINEL_SECRET_RAW_CHAT");
  expect(() =>
    decodePortableTask({ ...raw, transcript: "SENTINEL_SECRET_RAW_CHAT" }),
  ).toThrow("task-record-invalid");
});
it.each([
  { formatVersion: 2 },
  { id: "../../root" },
  { id: randomUUID().toUpperCase() },
  { title: "x".repeat(257) },
  { revision: 0 },
  { revision: 1.5 },
  { kind: "execution" },
  { depth: "small" },
  { approval: true },
  { sessionPath: "/private/session" },
  {
    latestSummary: [
      {
        statement: "x",
        source: { kind: "session", reference: "/private/session" },
      },
    ],
  },
  { artifacts: Array.from({ length: 65 }, () => ({})) },
])(
  "rejects malformed, oversized or capability-like record fields: %j",
  (patch) => {
    expect(() =>
      decodePortableTask({
        ...newPortableTask("x", "code", "compact"),
        ...patch,
      }),
    ).toThrow("task-record-invalid");
  },
);
it.each([
  "../brief.md",
  "/brief.md",
  "research/../brief.md",
  "research/a\\b.md",
  "task.json",
  "CON.md",
  "brief.md\0",
  "research/文件.md",
])("rejects artifact path %s", (p) => {
  expect(() =>
    decodePortableTask({
      ...newPortableTask("x", "research", "compact"),
      artifacts: [{ path: p, role: "brief", bytes: 0, sha256: taskHash("") }],
    }),
  ).toThrow();
});
it("bounds JSON, narrative UTF-8 and exact role/path/hash/size inventories", () => {
  const raw = newPortableTask("x", "code", "compact");
  expect(() =>
    parsePortableTask(b(" ".repeat(TASK_LIMITS.recordBytes + 1))),
  ).toThrow("task-record-invalid");
  expect(() => parsePortableTask(Uint8Array.of(0xff))).toThrow(
    "task-record-invalid",
  );
  const artifact = {
    path: "brief.md",
    role: "brief",
    bytes: 0,
    sha256: taskHash(""),
  };
  for (const artifacts of [
    [{ ...artifact, bytes: -1 }],
    [{ ...artifact, bytes: TASK_LIMITS.artifactBytes + 1 }],
    [{ ...artifact, sha256: "bad" }],
    [{ ...artifact, role: "result" }],
    [artifact, artifact],
  ])
    expect(() => decodePortableTask({ ...raw, artifacts })).toThrow(
      "task-record-invalid",
    );
  expect(() =>
    decodePortableTask({
      ...raw,
      latestSummary: [
        {
          statement: "字".repeat(1400),
          source: { kind: "model-summary", reference: "summary:1" },
        },
      ],
    }),
  ).toThrow("task-record-invalid");
});
it("reopens in a fresh process and uses the same real checkout fence as legacy hosts", () => {
  const { state, store, task } = seed();
  const script = `import {TaskStore} from ${JSON.stringify(storeUrl)}; const s=TaskStore.open(${JSON.stringify(state)}); console.log(JSON.stringify(s.get(${JSON.stringify(task.id)}))); s.close();`;
  expect(child(script).status).not.toBe(0);
  expect(() => acquirePackageState(state)).toThrow("package-state-in-use");
  store.close();
  const reopened = child(script);
  expect(reopened.stderr).not.toContain("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX");
  expect(reopened.status, reopened.stderr).toBe(0);
  expect(JSON.parse(reopened.stdout)).toEqual(task);
});
it("blocks an active legacy owner and conservatively retains all old apply/data bytes", () => {
  const { state } = fixture();
  const owner = acquirePackageState(state);
  const before = readFileSync(state.databasePath);
  expect(() => TaskStore.open(state)).toThrow("task-ownership-unresolved");
  owner.close();
  writeFileSync(
    path.join(state.transactionsDir, "partial-apply.json"),
    "SENTINEL_LEGACY_PARTIAL",
  );
  expect(() => TaskStore.open(state)).toThrow("task-ownership-unresolved");
  expect(readFileSync(state.databasePath)).toEqual(before);
  expect(
    readFileSync(
      path.join(state.transactionsDir, "partial-apply.json"),
      "utf8",
    ),
  ).toBe("SENTINEL_LEGACY_PARTIAL");
});
it.each([
  "ALTER TABLE task_records ADD COLUMN unknown TEXT",
  "DROP TABLE task_reviews",
  "CREATE TABLE unknown (x TEXT) STRICT",
  "DROP TABLE task_protocol; CREATE TABLE task_protocol (version INTEGER PRIMARY KEY CHECK(version = 2), root_hash TEXT NOT NULL) STRICT; INSERT INTO task_protocol VALUES (2, 'future')",
  "UPDATE task_protocol SET root_hash='foreign'",
  "CREATE TRIGGER injected AFTER INSERT ON task_records BEGIN DELETE FROM task_records; END",
])(
  "rejects wrong/unsupported schema without changing database bytes: %s",
  (sql) => {
    const { state, store } = seed();
    const file = store.databasePath;
    store.close();
    const db = new DatabaseSync(file);
    db.exec(sql);
    db.close();
    const before = readFileSync(file);
    expect(() => TaskStore.open(state)).toThrow("task-storage-invalid");
    expect(readFileSync(file)).toEqual(before);
  },
);
it("rejects corrupt retained legacy resources without resetting or backing them up", () => {
  const { state } = fixture();
  mkdirSync(state.rootDir, { recursive: true });
  writeFileSync(state.databasePath, "opaque legacy bytes");
  expect(() => TaskStore.open(state)).toThrow("task-ownership-unresolved");
  expect(readFileSync(state.databasePath, "utf8")).toBe("opaque legacy bytes");
});
it("publishes only managed targets, commits intent first and uses exact retry identity", () => {
  const { store, task, relative, target, consumerRoot } = seed();
  const publisher = new TaskPublisher(store, (point) => {
    if (point === "intent")
      expect(existsSync(path.join(consumerRoot, ".cadence"))).toBe(false);
  });
  const operation = publisher.prepare(task.id, relative, null, b("brief"));
  expect(existsSync(target)).toBe(false);
  expect(
    new TaskPublisher(store).prepare(
      task.id,
      relative,
      null,
      b("brief"),
      operation.operationId,
    ),
  ).toEqual(operation);
  expect(() =>
    publisher.prepare(
      task.id,
      relative,
      null,
      b("changed"),
      operation.operationId,
    ),
  ).toThrow("task-conflict");
  expect(() => publisher.prepare(task.id, relative, null, b("brief"))).toThrow(
    "task-conflict",
  );
  for (const p of [
    "AGENTS.md",
    "business.ts",
    `.cadence/tasks/${randomUUID()}/brief.md`,
    ".cadence/knowledge/../AGENTS.md",
  ])
    expect(() => publisher.prepare(task.id, p, null, b("x"))).toThrow(
      "task-path-unsafe",
    );
  expect(publisher.reconcile(operation.operationId).state).toBe("delivered");
  expect(readFileSync(target, "utf8")).toBe("brief");
  expect(publisher.reconcile(operation.operationId).state).toBe("delivered");
});
it.each([false, true])(
  "protects manual changes before publication (existing %s)",
  (existing) => {
    const { task, relative, target, publisher } = seed();
    mkdirSync(path.dirname(target), { recursive: true });
    if (existing) writeFileSync(target, "before");
    const op = publisher.prepare(
      task.id,
      relative,
      existing ? b("before") : null,
      b("desired"),
    );
    writeFileSync(target, "manual");
    expect(publisher.reconcile(op.operationId).state).toBe("conflict");
    expect(readFileSync(target, "utf8")).toBe("manual");
  },
);
it.each(["before-claim", "claimed", "written"] as const)(
  "preserves an external target edit at %s",
  (boundary) => {
    const { store, task, relative, target } = seed();
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "before");
    const publisher = new TaskPublisher(store, (point) => {
      if (point === boundary) writeFileSync(target, "manual");
    });
    const op = publisher.prepare(task.id, relative, b("before"), b("desired"));
    expect(publisher.reconcile(op.operationId).state).toBe("conflict");
    expect(readFileSync(target, "utf8")).toBe("manual");
    expect(new TaskPublisher(store).reconcile(op.operationId).state).toBe(
      "conflict",
    );
  },
);
it("preserves edits made through a retained renamed inode", () => {
  const { store, task, relative, target } = seed();
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "before");
  const publisher = new TaskPublisher(store, (point, op) => {
    if (point === "claimed")
      writeFileSync(`${target}.${op.operationId}.task-claim`, "late edit");
  });
  const op = publisher.prepare(task.id, relative, b("before"), b("desired"));
  expect(publisher.reconcile(op.operationId).state).toBe("conflict");
  expect(readFileSync(target, "utf8")).toBe("late edit");
});
it.each([
  "intent",
  "before-claim",
  "claimed",
  "written",
  "delivered",
] as PublicationBoundary[])(
  "reconciles interruption at %s after fresh-process reopen",
  (boundary) => {
    const { state, store, task, relative, target } = seed();
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "before");
    const operationId = randomUUID();
    const publisher = new TaskPublisher(store, (point) => {
      if (point === boundary) throw Error("injected-crash");
    });
    expect(() => {
      publisher.prepare(
        task.id,
        relative,
        b("before"),
        b("desired"),
        operationId,
      );
      publisher.reconcile(operationId);
    }).toThrow(boundary === "intent" ? "injected-crash" : "task-io-failed");
    store.close();
    const publisherUrl = pathToFileURL(
      path.resolve("src/task-publication.ts"),
    ).href;
    const result = child(
      `import {TaskStore} from ${JSON.stringify(storeUrl)}; import {TaskPublisher} from ${JSON.stringify(publisherUrl)}; const s=TaskStore.open(${JSON.stringify(state)}); console.log(new TaskPublisher(s).reconcile(${JSON.stringify(operationId)}).state); s.close();`,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("delivered");
    expect(readFileSync(target, "utf8")).toBe("desired");
  },
);
it("settles desired bytes after interruption but never silently adopts another operation", () => {
  const { task, relative, target, publisher } = seed();
  const op = publisher.prepare(task.id, relative, null, b("desired"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "desired");
  expect(publisher.reconcile(op.operationId).state).toBe("delivered");
  expect(() =>
    publisher.prepare(
      task.id,
      relative,
      b("desired"),
      b("new"),
      op.operationId,
    ),
  ).toThrow("task-conflict");
});
it.each(["parent-link", "target-link", "hardlink", "directory"])(
  "rejects unsafe filesystem entry %s",
  (kind) => {
    const { root, consumerRoot, task, relative, target, publisher } = seed();
    const outside = path.join(root, "outside");
    mkdirSync(outside);
    const sentinel = path.join(outside, "sentinel");
    writeFileSync(sentinel, "preserve");
    const op = publisher.prepare(task.id, relative, null, b("desired"));
    if (kind === "parent-link")
      symlinkSync(
        outside,
        path.join(consumerRoot, ".cadence"),
        process.platform === "win32" ? "junction" : "dir",
      );
    else {
      mkdirSync(path.dirname(target), { recursive: true });
      if (kind === "target-link") symlinkSync(sentinel, target);
      else if (kind === "hardlink") linkSync(sentinel, target);
      else mkdirSync(target);
    }
    expect(() => publisher.reconcile(op.operationId)).toThrow(
      "task-path-unsafe",
    );
    expect(readFileSync(sentinel, "utf8")).toBe("preserve");
  },
);
it("keeps whole-file review bytes immutable while result/progress publication remains separate", () => {
  const { store, task, relative, target, publisher } = seed();
  publisher.reconcile(
    publisher.prepare(task.id, relative, null, b("goal and acceptance"))
      .operationId,
  );
  const updated = store.revise({
    ...task,
    revision: 2,
    artifacts: [
      {
        path: "brief.md",
        role: "brief",
        sha256: taskHash("goal and acceptance"),
        bytes: b("goal and acceptance").length,
      },
    ],
  });
  const review = publisher.freezeReview(task.id);
  expect(publisher.freezeReview(task.id)).toEqual(review);
  store.revise({
    ...updated,
    revision: 3,
    latestSummary: [
      {
        statement: "Progress only",
        source: { kind: "model-summary", reference: "progress:1" },
      },
    ],
  });
  publisher.reconcile(
    publisher.prepare(
      task.id,
      relative.replace("brief.md", "result.md"),
      null,
      b("result"),
    ).operationId,
  );
  expect(publisher.reviewCurrent(task.id, 2)).toBe(true);
  expect(store.review(task.id, 2)).toEqual(review);
  writeFileSync(target, "changed goal");
  expect(publisher.reviewCurrent(task.id, 2)).toBe(false);
  expect(() => publisher.freezeReview(task.id)).toThrow("task-review-stale");
  expect(
    Buffer.from(
      store.reviewBytes(review.digest, review.artifacts[0]),
    ).toString(),
  ).toBe("goal and acceptance");
  expect(() =>
    store.revise({ ...updated, revision: 4, lifecycle: "approved" }),
  ).toThrow("task-conflict");
});
it("imports archived/approved portable text as context without sessions or local authority", () => {
  const { consumerRoot, task, publisher } = seed();
  for (const lifecycle of ["approved", "archived"] as const) {
    const record = { ...task, lifecycle };
    const relative = `.cadence/tasks/${task.id}/task.json`;
    const target = path.join(consumerRoot, relative);
    const expected = existsSync(target) ? readFileSync(target) : null;
    publisher.reconcile(
      publisher.prepare(task.id, relative, expected, b(canonicalJson(record)))
        .operationId,
    );
    expect(importTask(consumerRoot, task.id)).toEqual({
      record,
      authority: "context-only",
    });
  }
  expect(discoverTasks([consumerRoot])).toHaveLength(1);
  const empty = fixture();
  expect(existsSync(empty.state.productRoot)).toBe(false);
  expect(discoverTasks([empty.consumerRoot])).toEqual([]);
  expect(existsSync(empty.state.productRoot)).toBe(false);
});
it("detects divergent duplicate identities and artifact drift without importing private facts", () => {
  const { consumerRoot, task, publisher } = seed();
  const other = fixture();
  const relative = `.cadence/tasks/${task.id}/task.json`;
  publisher.reconcile(
    publisher.prepare(task.id, relative, null, b(canonicalJson(task)))
      .operationId,
  );
  const target = path.join(other.consumerRoot, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, canonicalJson(task));
  expect(discoverTasks([consumerRoot, other.consumerRoot])).toHaveLength(1);
  writeFileSync(target, canonicalJson({ ...task, title: "divergent" }));
  expect(() => discoverTasks([consumerRoot, other.consumerRoot])).toThrow(
    "task-conflict",
  );
  writeFileSync(
    target,
    canonicalJson({
      ...task,
      artifacts: [
        { path: "brief.md", role: "brief", bytes: 1, sha256: taskHash("x") },
      ],
    }),
  );
  expect(() => importTask(other.consumerRoot, task.id)).toThrow(
    "task-conflict",
  );
  expect(existsSync(other.state.productRoot)).toBe(false);
});

it.each(["claimed", "written"] as const)(
  "recovers a real process exit with SQLite ownership held at %s",
  (boundary) => {
    const { state, store, task, relative, target, publisher } = seed();
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "before");
    const op = publisher.prepare(task.id, relative, b("before"), b("desired"));
    store.close();
    const publisherUrl = pathToFileURL(
      path.resolve("src/task-publication.ts"),
    ).href;
    const result = child(
      `import {TaskStore} from ${JSON.stringify(storeUrl)}; import {TaskPublisher} from ${JSON.stringify(publisherUrl)}; const s=TaskStore.open(${JSON.stringify(state)}); new TaskPublisher(s, p => { if(p === ${JSON.stringify(boundary)}) process.exit(73); }).reconcile(${JSON.stringify(op.operationId)});`,
    );
    expect(result.status, result.stderr).toBe(73);
    const recovered = open(state);
    expect(new TaskPublisher(recovered).reconcile(op.operationId).state).toBe(
      "delivered",
    );
    expect(readFileSync(target, "utf8")).toBe("desired");
  },
);
it("retains divergent recovery claims rather than erasing recovery material", () => {
  const { store, task, relative, target, publisher } = seed();
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "before");
  const op = publisher.prepare(task.id, relative, b("before"), b("desired"));
  const interrupted = new TaskPublisher(store, (point, operation) => {
    if (point === "claimed") {
      writeFileSync(
        `${target}.${operation.operationId}.task-claim`,
        "external claimed edit",
      );
      throw Error("crash");
    }
  });
  expect(() => interrupted.reconcile(op.operationId)).toThrow("task-io-failed");
  expect(publisher.reconcile(op.operationId).state).toBe("conflict");
  expect(readFileSync(`${target}.${op.operationId}.task-claim`, "utf8")).toBe(
    "external claimed edit",
  );
  expect(existsSync(target)).toBe(false);
});
it("blocks symlinked private namespaces and retained legacy reset/backup evidence", () => {
  const { state, root } = fixture();
  const outside = path.join(root, "outside");
  mkdirSync(outside);
  mkdirSync(state.productRoot, { recursive: true });
  symlinkSync(
    outside,
    path.join(state.productRoot, "task-v1"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() => TaskStore.open(state)).toThrow();
  expect(existsSync(path.join(outside, state.consumerRootHash))).toBe(false);
  rmSync(path.join(state.productRoot, "task-v1"));
  const coordinator = path.join(
    state.rootsDir,
    `${state.consumerRootHash}.package-state`,
  );
  writeFileSync(path.join(coordinator, "reset.json"), "not even valid JSON");
  expect(() => TaskStore.open(state)).toThrow("task-ownership-unresolved");
  expect(readFileSync(path.join(coordinator, "reset.json"), "utf8")).toBe(
    "not even valid JSON",
  );
});
it("does not publish through a parent exchanged for a link during the claim boundary", () => {
  const { store, root, task, relative, target } = seed();
  const outside = path.join(root, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "brief.md"), "outside sentinel");
  const publisher = new TaskPublisher(store, (point) => {
    if (point === "before-claim") {
      rmSync(path.dirname(target), { recursive: true });
      symlinkSync(
        outside,
        path.dirname(target),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
  });
  const op = publisher.prepare(task.id, relative, null, b("desired"));
  expect(publisher.reconcile(op.operationId).state).toBe("conflict");
  expect(readFileSync(path.join(outside, "brief.md"), "utf8")).toBe(
    "outside sentinel",
  );
});
it("requires the expanded whole-file review set and does not treat research/results as reviewed intent", () => {
  const { state } = fixture();
  const store = open(state);
  const task = store.create("Expanded", "code", "expanded");
  expect(() => store.freezeReview(task.id, new Map())).toThrow(
    "task-record-invalid",
  );
  const artifacts = [
    ["prd.md", "requirements"],
    ["design.md", "design"],
    ["implement.md", "plan"],
    ["research/note.md", "research"],
  ].map(([p, role]) => ({
    path: p,
    role,
    sha256: taskHash(p),
    bytes: b(p).length,
  }));
  store.revise({ ...task, revision: 2, artifacts });
  const review = store.freezeReview(
    task.id,
    new Map(artifacts.slice(0, 3).map((a) => [a.path, b(a.path)])),
  );
  expect(review.artifacts.map((a) => a.role)).toEqual([
    "requirements",
    "design",
    "plan",
  ]);
});
it("validates publication payloads and permits only bounded explicit knowledge targets", () => {
  const { consumerRoot, task, publisher } = seed();
  expect(() =>
    publisher.prepare(
      task.id,
      `.cadence/tasks/${task.id}/task.json`,
      null,
      b(canonicalJson({ ...task, id: randomUUID() })),
    ),
  ).toThrow("task-record-invalid");
  expect(() =>
    publisher.prepare(
      task.id,
      `.cadence/tasks/${task.id}/brief.md`,
      null,
      Uint8Array.of(0xff),
    ),
  ).toThrow("task-record-invalid");
  const op = publisher.prepare(
    task.id,
    ".cadence/knowledge/factual-note.md",
    null,
    b("Explicit sourced note"),
  );
  expect(publisher.reconcile(op.operationId).state).toBe("delivered");
  expect(
    readFileSync(
      path.join(consumerRoot, ".cadence/knowledge/factual-note.md"),
      "utf8",
    ),
  ).toBe("Explicit sourced note");
});

it.runIf(process.platform !== "win32")(
  "rejects a FIFO without opening or blocking on it",
  () => {
    const { task, relative, target, publisher } = seed();
    const op = publisher.prepare(task.id, relative, null, b("desired"));
    mkdirSync(path.dirname(target), { recursive: true });
    expect(spawnSync("mkfifo", [target]).status).toBe(0);
    expect(() => publisher.reconcile(op.operationId)).toThrow(
      "task-path-unsafe",
    );
  },
);
it("bounds file reads and discovery without creating private state", () => {
  const { task, relative, target, publisher } = seed();
  const op = publisher.prepare(task.id, relative, null, b("desired"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "");
  truncateSync(target, TASK_LIMITS.artifactBytes + 1);
  expect(() => publisher.reconcile(op.operationId)).toThrow("task-path-unsafe");
  const other = fixture();
  for (let i = 0; i <= TASK_LIMITS.discovery; i++) {
    const record = newPortableTask("Imported", "research", "compact");
    const directory = path.join(
      other.consumerRoot,
      ".cadence/tasks",
      record.id,
    );
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "task.json"), canonicalJson(record));
  }
  expect(() => discoverTasks([other.consumerRoot])).toThrow("task-path-unsafe");
  expect(existsSync(other.state.productRoot)).toBe(false);
});
it("does not copy raw chat, output or environment fields into portable publication", () => {
  const { store, task, consumerRoot, publisher } = seed();
  const raw = {
    summary: "Selected safe conclusion",
    chat: "SENTINEL_CHAT",
    output: "SENTINEL_OUTPUT",
    environment: "SENTINEL_ENV",
  };
  const record = store.revise({
    ...task,
    revision: 2,
    latestSummary: [
      {
        statement: raw.summary,
        source: { kind: "evidence-summary", reference: "evidence:1" },
      },
    ],
  });
  const relative = `.cadence/tasks/${task.id}/task.json`;
  publisher.reconcile(
    publisher.prepare(task.id, relative, null, b(canonicalJson(record)))
      .operationId,
  );
  const published = readFileSync(path.join(consumerRoot, relative), "utf8");
  expect(published).toContain(raw.summary);
  for (const forbidden of [raw.chat, raw.output, raw.environment])
    expect(published).not.toContain(forbidden);
  for (const key of [
    "chat",
    "rawOutput",
    "environment",
    "credentials",
    "sessionPath",
  ])
    expect(() => decodePortableTask({ ...record, [key]: "SENTINEL" })).toThrow(
      "task-record-invalid",
    );
});

it.each([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])("rejects portable Windows device basename %s on every platform", (name) => {
  const id = randomUUID();
  expect(() => taskArtifactPath(`research/${name}.md`)).toThrow(
    "task-path-unsafe",
  );
  expect(() =>
    taskPublicationPath(id, `.cadence/knowledge/${name}.md`),
  ).toThrow("task-path-unsafe");
  expect(taskArtifactPath(`research/${name}-notes.md`)).toBe(
    `research/${name}-notes.md`,
  );
  expect(taskPublicationPath(id, `.cadence/knowledge/${name}-notes.md`)).toBe(
    `.cadence/knowledge/${name}-notes.md`,
  );
});

function legacySnapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true }).map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return [
        path.relative(root, file),
        entry.isFile() ? taskHash(readFileSync(file)) : "directory",
      ];
    }),
  );
}
it.each([
  "empty",
  "unversioned-empty",
  "discarded",
  "rejected",
  "completed",
] as const)(
  "admits a closed supported legacy %s store without touching history",
  (terminal) => {
    const f = fixture();
    if (terminal === "unversioned-empty") RunStore.open(f.state).close();
    else acquirePackageState(f.state).close();
    if (terminal !== "empty" && terminal !== "unversioned-empty") {
      const legacy = RunStore.open(f.state);
      try {
        const run = legacy.startRun({
          stage: "abel-design",
          change: "historic",
          operationId: "old-start",
        });
        if (terminal === "completed")
          legacy.transition({
            runId: run.runId,
            to: "paused",
            operationId: "old-pause",
          });
        legacy.transition({
          runId: run.runId,
          to: terminal,
          operationId: "old-end",
        });
      } finally {
        legacy.close();
      }
    }
    const before = legacySnapshot(f.state.rootDir);
    const store = open(f.state);
    expect(store.create("New independent planning").lifecycle).toBe("planning");
    store.close();
    expect(legacySnapshot(f.state.rootDir)).toEqual(before);
    const child = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `
    import {TaskStore} from ${JSON.stringify(pathToFileURL(path.resolve("src/task-store.ts")).href)};
    TaskStore.open(${JSON.stringify(f.state)}).close();
  `,
      ],
      { encoding: "utf8" },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(legacySnapshot(f.state.rootDir)).toEqual(before);
  },
);
it.each([
  "active",
  "lease",
  "corrupt-event",
  "corrupt-projection",
  "unknown-schema",
  "partial-apply",
  "sidecar",
])("blocks legacy %s evidence without changing it", (fault) => {
  const f = fixture();
  acquirePackageState(f.state).close();
  const legacy = RunStore.open(f.state);
  const run = legacy.startRun({
    stage: "abel-design",
    change: "historic",
    operationId: "start",
  });
  if (fault !== "active")
    legacy.transition({
      runId: run.runId,
      to: "discarded",
      operationId: "end",
    });
  if (fault === "lease")
    legacy.acquireLease({
      runId: run.runId,
      operationId: "live",
      ttlMs: 60_000,
    });
  legacy.close();
  const db = new DatabaseSync(f.state.databasePath);
  try {
    if (fault === "corrupt-event")
      db.exec("UPDATE events SET event_hash = 'broken' WHERE sequence = 1");
    if (fault === "corrupt-projection")
      db.exec("UPDATE runs SET projection_json = '{}'");
    if (fault === "unknown-schema")
      db.exec("CREATE TABLE unknown (id TEXT) STRICT");
    if (fault === "partial-apply")
      db.prepare(
        "INSERT INTO apply_transactions VALUES ('partial', ?, 'applying', '{}', NULL)",
      ).run(run.runId);
  } finally {
    db.close();
  }
  if (fault === "sidecar")
    writeFileSync(`${f.state.databasePath}-wal`, "unresolved");
  const before = legacySnapshot(f.state.rootDir);
  expect(() => open(f.state)).toThrow("task-ownership-unresolved");
  expect(legacySnapshot(f.state.rootDir)).toEqual(before);
});

it.each(["exact", "declared-over", "actual-over"])(
  "bounds aggregate review reads: %s",
  (kind) => {
    const f = fixture(),
      store = open(f.state);
    let task = store.create("Expanded bounded review", "research", "expanded");
    const first = Buffer.alloc(TASK_LIMITS.artifactBytes / 2, "a");
    const second = Buffer.alloc(
      TASK_LIMITS.artifactBytes / 2 + (kind === "declared-over" ? 1 : 0),
      "b",
    );
    task = store.revise({
      ...task,
      revision: 2,
      artifacts: [
        {
          path: "prd.md",
          role: "requirements",
          bytes: first.length,
          sha256: taskHash(first),
        },
        {
          path: "design.md",
          role: "design",
          bytes: second.length,
          sha256: taskHash(second),
        },
      ],
    });
    const dir = path.join(f.consumerRoot, ".cadence/tasks", task.id);
    mkdirSync(dir, { recursive: true });
    if (kind === "declared-over") {
      // Preflight must fail before opening even the first (unsafe) artifact.
      symlinkSync(path.join(f.root, "absent"), path.join(dir, "prd.md"));
      expect(() => new TaskPublisher(store).freezeReview(task.id)).toThrow(
        "task-review-stale",
      );
    } else {
      writeFileSync(path.join(dir, "prd.md"), first);
      writeFileSync(
        path.join(dir, "design.md"),
        kind === "actual-over" ? Buffer.concat([second, b("!")]) : second,
      );
      if (kind === "actual-over")
        expect(() => new TaskPublisher(store).freezeReview(task.id)).toThrow(
          "task-path-unsafe",
        );
      else
        expect(
          new TaskPublisher(store)
            .freezeReview(task.id)
            .artifacts.reduce((n, a) => n + a.bytes, 0),
        ).toBe(TASK_LIMITS.artifactBytes);
    }
  },
);

it.each([
  "record-hash",
  "review-bytes",
  "review-manifest",
  "publication-identity",
  "publication-bytes",
  "publication-hash",
])("rejects direct private integrity corruption: %s", (fault) => {
  const f = seed();
  f.store.revise({
    ...f.task,
    revision: 2,
    artifacts: [
      {
        path: "brief.md",
        role: "brief",
        bytes: 8,
        sha256: taskHash("reviewed"),
      },
    ],
  });
  f.store.freezeReview(f.task.id, new Map([["brief.md", b("reviewed")]]));
  const op = new TaskPublisher(f.store).prepare(
    f.task.id,
    f.relative,
    null,
    b("desired"),
  );
  const file = f.store.databasePath;
  f.store.close();
  const db = new DatabaseSync(file);
  try {
    const sql: Record<string, string> = {
      "record-hash": "UPDATE task_records SET payload_hash = 'broken'",
      "review-bytes": "UPDATE task_review_bytes SET bytes = x'00'",
      "review-manifest": "UPDATE task_reviews SET manifest_json = '{}'",
      "publication-identity":
        "UPDATE task_publications SET path = '.cadence/knowledge/other.md'",
      "publication-bytes": "UPDATE task_publications SET desired = x'00'",
      "publication-hash":
        "UPDATE task_publications SET identity_hash = 'broken'",
    };
    db.exec(sql[fault]);
  } finally {
    db.close();
  }
  const store = open(f.state);
  const read = () =>
    fault.startsWith("record")
      ? store.get(f.task.id)
      : fault.startsWith("review")
        ? store.review(f.task.id, 2)
        : store.publication(op.operationId);
  expect(read).toThrow("task-storage-invalid");
  expect(existsSync(f.target)).toBe(false);
});

/** Real syscall wrappers are confined to a fresh Node child, never the test host. */
function crashPublication(
  f: ReturnType<typeof seed>,
  operationId: string,
  mode: "install" | "restore" | "editor",
): void {
  f.store.close();
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    import {TaskStore} from ${JSON.stringify(pathToFileURL(path.resolve("src/task-store.ts")).href)};
    import {TaskPublisher} from ${JSON.stringify(pathToFileURL(path.resolve("src/task-publication.ts")).href)};
    const target = ${JSON.stringify(f.target)}, mode = ${JSON.stringify(mode)};
    const claim = target + '.' + ${JSON.stringify(operationId)} + '.task-claim';
    const install = target + '.' + ${JSON.stringify(operationId)} + '.task-install';
    const store = TaskStore.open(${JSON.stringify(f.state)});
    const originalLink = fs.linkSync, originalClose = fs.closeSync;
    let edited = false;
    const editor = mode === 'editor' ? fs.openSync(target, 'r+') : undefined;
    const inode = editor === undefined ? undefined : fs.fstatSync(editor);
    fs.linkSync = (from, to) => {
      originalLink(from, to);
      if ((mode === 'install' && from === install) || (mode === 'restore' && from === claim)) process.exit(73);
    };
    // The save occurs AFTER the final successful claim read/currentness checks,
    // at close(2), before delivery is committed. It uses the ordinary original fd.
    fs.closeSync = fd => {
      const stat = fs.fstatSync(fd);
      if (mode === 'editor' && !edited && fd !== editor && stat.ino === inode.ino && stat.dev === inode.dev && fs.existsSync(target) && !fs.existsSync(install) && fs.readFileSync(target, 'utf8') === 'desired') {
        edited = true;
        fs.ftruncateSync(editor, 0); fs.writeSync(editor, 'late editor save', 0, 'utf8'); fs.fsyncSync(editor);
      }
      return originalClose(fd);
    };
    syncBuiltinESMExports();
    const publisher = new TaskPublisher(store, point => {
      if (mode === 'restore' && point === 'before-claim') fs.writeFileSync(target, 'racing editor save');
    });
    const result = publisher.reconcile(${JSON.stringify(operationId)});
    if (mode === 'editor') {
      if (!edited || result.state !== 'delivered' || fs.fstatSync(editor).nlink < 1) process.exit(91);
      originalClose(editor);
      process.exit(74); // die after delivery, without graceful storage close
    }
    process.exit(92);
  `,
    ],
    { encoding: "utf8" },
  );
  expect(child.status, child.stderr).toBe(mode === "editor" ? 74 : 73);
}
it.each([false, true])(
  "recovers exact install links after link(2) and before unlink(2), existing=%s",
  (existing) => {
    const f = seed();
    if (existing) {
      mkdirSync(path.dirname(f.target), { recursive: true });
      writeFileSync(f.target, "old");
    }
    const op = new TaskPublisher(f.store).prepare(
      f.task.id,
      f.relative,
      existing ? b("old") : null,
      b("desired"),
    );
    crashPublication(f, op.operationId, "install");
    const install = `${f.target}.${op.operationId}.task-install`;
    expect(lstatSync(f.target).nlink).toBe(2);
    expect(lstatSync(f.target).ino).toBe(lstatSync(install).ino);
    const unrelated = path.join(path.dirname(f.target), ".unrelated.apply-tmp");
    writeFileSync(unrelated, "not ours");
    const reopened = open(f.state);
    expect(new TaskPublisher(reopened).reconcile(op.operationId).state).toBe(
      "delivered",
    );
    expect(lstatSync(f.target).nlink).toBe(1);
    expect(existsSync(install)).toBe(false);
    expect(readFileSync(unrelated, "utf8")).toBe("not ours");
    if (existing)
      expect(
        readFileSync(`${f.target}.${op.operationId}.task-claim`, "utf8"),
      ).toBe("old");
  },
);
it("retains exact restore links across a syscall crash without treating edited bytes as delivery", () => {
  const f = seed();
  mkdirSync(path.dirname(f.target), { recursive: true });
  writeFileSync(f.target, "old");
  const op = new TaskPublisher(f.store).prepare(
    f.task.id,
    f.relative,
    b("old"),
    b("desired"),
  );
  crashPublication(f, op.operationId, "restore");
  const claim = `${f.target}.${op.operationId}.task-claim`;
  expect(lstatSync(f.target).ino).toBe(lstatSync(claim).ino);
  expect(lstatSync(f.target).nlink).toBe(2);
  const reopened = open(f.state);
  expect(new TaskPublisher(reopened).reconcile(op.operationId).state).toBe(
    "conflict",
  );
  expect(readFileSync(claim, "utf8")).toBe("racing editor save");
  expect(readFileSync(f.target, "utf8")).toBe("racing editor save");
});
it("keeps the original claimed inode through delivery for a retained-descriptor save after the last read", () => {
  const f = seed();
  mkdirSync(path.dirname(f.target), { recursive: true });
  writeFileSync(f.target, "old");
  const original = lstatSync(f.target);
  const op = new TaskPublisher(f.store).prepare(
    f.task.id,
    f.relative,
    b("old"),
    b("desired"),
  );
  crashPublication(f, op.operationId, "editor");
  const claim = `${f.target}.${op.operationId}.task-claim`;
  const reopened = open(f.state);
  expect(new TaskPublisher(reopened).reconcile(op.operationId).state).toBe(
    "delivered",
  );
  expect(readFileSync(f.target, "utf8")).toBe("desired");
  expect(readFileSync(claim, "utf8")).toBe("late editor save");
  expect(lstatSync(claim).ino).toBe(original.ino);
  expect(lstatSync(claim).dev).toBe(original.dev);
});
it.each(["third-link", "edited-install", "wrong-inode"])(
  "does not clean unproved recovery links: %s",
  (fault) => {
    const f = seed();
    const op = new TaskPublisher(f.store).prepare(
      f.task.id,
      f.relative,
      null,
      b("desired"),
    );
    crashPublication(f, op.operationId, "install");
    const install = `${f.target}.${op.operationId}.task-install`;
    const unrelated = `${f.target}.not-ours`;
    if (fault === "third-link") linkSync(f.target, unrelated);
    if (fault === "edited-install") writeFileSync(install, "edited recovery");
    if (fault === "wrong-inode") {
      rmSync(install);
      writeFileSync(install, "desired");
    }
    const reopened = open(f.state),
      publisher = new TaskPublisher(reopened);
    if (fault === "third-link")
      expect(() => publisher.reconcile(op.operationId)).toThrow(
        "task-path-unsafe",
      );
    else expect(publisher.reconcile(op.operationId).state).toBe("conflict");
    expect(existsSync(install)).toBe(true);
    expect(readFileSync(f.target, "utf8")).toBe(
      fault === "edited-install" ? "edited recovery" : "desired",
    );
    if (fault === "third-link") expect(existsSync(unrelated)).toBe(true);
  },
);

it("does not let immutable legacy inspection bypass an uncoordinated rollback-journal exclusive lock", () => {
  const f = fixture();
  acquirePackageState(f.state).close();
  const db = new DatabaseSync(f.state.databasePath);
  try {
    db.exec("PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE");
    expect(existsSync(`${f.state.databasePath}-journal`)).toBe(false);
    const before = legacySnapshot(f.state.rootDir);
    expect(() => open(f.state)).toThrow("task-ownership-unresolved");
    expect(legacySnapshot(f.state.rootDir)).toEqual(before);
  } finally {
    db.close();
  }
});
