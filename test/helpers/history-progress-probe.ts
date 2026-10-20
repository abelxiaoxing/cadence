/** Excluded ordinary-Node counterexample, not a passing feature test or runtime.
 * Only fabricated records in the caller's newly allocated private directory. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HistoryFiles, HistoryReadBudget } from "../../src/history/files.ts";
import { HistoryProjection } from "../../src/history/projection.ts";
import { HistoryReader } from "../../src/history/reader.ts";
import { HistoryRecovery } from "../../src/history/recovery.ts";
import {
  parseScanCursor,
  scanCursor,
  searchHistory,
} from "../../src/history/search.ts";
import { encodeJournalText, type JournalRow } from "../../src/history/types.ts";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { inspectRecovery } from "../../src/service/recovery.ts";
import {
  type ExportRequest,
  encodeExportFrame,
  LIMITS,
  type ReadCursor,
  type SearchPage,
} from "../../src/service-contract.ts";
import { historyFixture } from "./history-fixture.ts";
import { storedTree } from "./history-read-fixture.ts";

const [mode, directory] = process.argv.slice(2);
const selectedPath = join(directory, "selected.json");
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const ledgerIdentity = (files: HistoryFiles) =>
  Object.fromEntries(
    readdirSync(join(files.directory, "ledger"))
      .sort()
      .map((name) => [
        name,
        digest(readFileSync(join(files.directory, "ledger", name))),
      ]),
  );

if (mode === "produce") {
  const f = historyFixture({}, directory);
  let state = f.files.inspect();
  const taskId = randomUUID();
  // Real append/flush, structural Create-shaped facts; no actual task creation,
  // provider request, or SDK execution. Full records remain <= their normal caps.
  const pending: JournalRow[] = [];
  for (let ordinal = 0; ; ordinal++) {
    const commandId = randomUUID(),
      operationId = randomUUID(),
      identity = {
        kind: "action" as const,
        expected: { ...f.context, task: null },
        action: {
          kind: "create" as const,
          taskKind: "research" as const,
          goal: ordinal === 0 ? "progress-target" : "z".repeat(7900),
        },
      };
    const row: JournalRow = {
      kind: "record",
      id: randomUUID(),
      seq: String(BigInt(state.committedSeq) + BigInt(pending.length) + 1n),
      value: {
        kind: "admission",
        intent: {
          commandId,
          operationId,
          runId: null,
          createdTaskId: ordinal === 0 ? taskId : randomUUID(),
          identity,
        },
        record: {
          identity,
          receipt: {
            commandId,
            operationId,
            runId: null,
            admission: "accepted",
            committedSeq: String(
              BigInt(state.committedSeq) + BigInt(pending.length) + 1n,
            ),
            execution: null,
            settlement: null,
            created: null,
            publication: "pending",
          },
        },
      },
    };
    if (row.value.kind !== "admission") throw Error("fixture shape");
    assert.ok(row.value.intent.createdTaskId);
    row.value.record.receipt.created = {
      kind: "task",
      taskId: row.value.intent.createdTaskId,
      state: "reserved",
    };
    pending.push(row);
    if (pending.length < 32) continue;
    state = await f.files.append(f.lease, state, pending.splice(0));
    if (state.bytes > LIMITS.segmentBytes - 512 * 1024) break;
  }
  assert.equal(state.segment, 1);
  assert.ok(state.records < LIMITS.segmentRecords);
  const remaining = LIMITS.segmentBytes - state.bytes;
  assert.ok(remaining > 20 && remaining < 512 * 1024);
  // A bounded final incomplete JSON line, not corruption inside a committed batch.
  appendFileSync(
    f.files.segmentPath(1),
    `{"incomplete":"${"x".repeat(remaining - 15)}`,
  );
  assert.equal(
    readFileSync(f.files.segmentPath(1)).length,
    LIMITS.segmentBytes,
  );
  const inspected = f.files.inspect();
  assert.equal(inspected.tail, true);
  writeFileSync(
    selectedPath,
    JSON.stringify({ root: f.root, state: join(directory, "state"), taskId }),
  );
  process.exit(77); // Original waited dead owner, no cleanup or inferred closure.
} else if (mode === "read" || mode === "detail") {
  const input = JSON.parse(readFileSync(process.argv[4], "utf8"));
  const reader = HistoryReader.open(
    new ServiceCoordination(input.root, input.state),
  );
  assert.ok(reader);
  try {
    const page =
      mode === "detail"
        ? await reader.readDetail(input.cursor)
        : await searchHistory(reader, input.cursor);
    process.stdout.write(JSON.stringify({ status: "page", page }));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        status: "refused",
        code:
          error && typeof error === "object" && "code" in error
            ? error.code
            : "unexpected",
      }),
    );
  }
} else if (mode === "export") {
  const input = JSON.parse(readFileSync(process.argv[4], "utf8"));
  const reader = HistoryReader.open(
    new ServiceCoordination(input.root, input.state),
  );
  assert.ok(reader);
  const unavailable = (): never => {
    throw Error("Unexpected control access");
  };
  const projection = new HistoryProjection(reader, {
    session: unavailable,
    workspace: unavailable,
    context: unavailable,
    checks: unavailable,
    legacyTasks: unavailable,
  });
  const request: ExportRequest = {
    storeId: reader.storeId,
    scope: input.cursor.scope,
    snapshotSeq: input.cursor.snapshotSeq,
    format: input.format,
  };
  const original = storedTree(reader.files.directory),
    sum = createHash("sha256");
  let frames = 0,
    bytes = 0,
    text = "",
    trailer = false;
  for await (const frame of projection.export(
    request,
    new AbortController().signal,
  )) {
    assert.equal(trailer, false);
    if (frame.event.kind === "trailer") {
      assert.equal(frame.event.frames, frames);
      assert.equal(frame.event.encodedBytes, bytes);
      assert.equal(frame.event.sha256, sum.digest("hex"));
      trailer = true;
    } else {
      const encoded = encodeExportFrame(frame, request.format);
      sum.update(encoded);
      bytes += Buffer.byteLength(encoded);
      frames++;
      if (frame.event.kind === "detail") text += frame.event.text;
      if (frame.event.kind === "markdown") text += frame.event.text;
    }
  }
  assert.equal(trailer, true);
  assert.ok(text.includes("progress-target"));
  if (input.format === "ndjson") assert.equal(text, "progress-target");
  assert.deepEqual(storedTree(reader.files.directory), original);
  process.stdout.write(
    JSON.stringify({
      format: input.format,
      frames,
      bytes,
      trailer,
      sourceUnchanged: true,
      exactTarget: true,
    }),
  );
} else if (
  mode === "probe" ||
  mode === "probe-twice" ||
  mode === "probe-bad-head"
) {
  mkdirSync(directory, { mode: 0o700 });
  const env = {
    ...process.env,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
  };
  assert.ok(env.TMPDIR && env.TEMP === env.TMPDIR && env.TMP === env.TMPDIR);
  const original = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), "produce", directory],
    { env, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(original.status, 77, original.stderr);
  assert.equal(original.signal, null);
  assert.equal(original.stderr, "");
  const selected = JSON.parse(readFileSync(selectedPath, "utf8"));
  const c = new ServiceCoordination(selected.root, selected.state),
    files = HistoryFiles.open(c);
  assert.ok(files);
  const predecessor = readFileSync(files.segmentPath(1));
  const recovery = new HistoryRecovery(c),
    expected = await inspectRecovery(c, recovery);
  assert.equal(expected.owner, "absent");
  let fact = await recovery.append({
    expected,
    acknowledgeEscapedProcesses: true,
    processes: "externally-resolved",
    credentials: "independently-resolved",
    storage: "independently-resolved",
    // Fabricated interactive authority only, not a production management claim.
    assertLocalAuthority: (choice) => assert.deepEqual(choice, expected),
  });
  assert.deepEqual(readFileSync(files.segmentPath(1)), predecessor);
  const [bridge, marker] = readFileSync(files.segmentPath(2), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  const state = files.inspect();
  assert.equal(state.committedSeq, fact.committedSeq);
  assert.equal(bridge.value.previous.bytes, LIMITS.segmentBytes);
  if (mode === "probe-twice") {
    // A real preserved complete uncommitted row plus fragment, not a no-op
    // committed marker invented to manufacture traversal progress.
    appendFileSync(
      files.segmentPath(2),
      `${encodeJournalText({
        kind: "record",
        id: randomUUID(),
        seq: String(BigInt(fact.committedSeq) + 1n),
        value: { kind: "owner-epoch", epoch: randomUUID() },
      })}{"torn":`,
    );
    const again = await inspectRecovery(c, recovery);
    fact = await recovery.append({
      expected: again,
      acknowledgeEscapedProcesses: true,
      processes: "externally-resolved",
      credentials: "independently-resolved",
      storage: "independently-resolved",
      assertLocalAuthority: (choice) => assert.deepEqual(choice, again),
    });
    assert.equal(files.inspect().segment, 3);
  }
  if (mode === "probe-bad-head") {
    const heads = join(files.directory, "indexes", "heads");
    mkdirSync(heads, { recursive: true, mode: 0o700 });
    writeFileSync(join(heads, "latest.json"), '{"unusable":true}', {
      mode: 0o600,
    });
  }
  const before = ledgerIdentity(files),
    treeBefore = storedTree(files.directory);
  let cursor: ReadCursor = {
    storeId: files.format.storeId,
    scope: { kind: "task", id: selected.taskId },
    snapshotSeq: fact.committedSeq,
    query: "progress-target",
    recordId: null,
    recordVersion: null,
    field: null,
    offset: 0,
  };
  const pages: (
    | { status: "page"; page: SearchPage }
    | { status: "refused"; code: string }
  )[] = [];
  for (let i = 0; i < 1000; i++) {
    const input = join(directory, `read-${i}.json`);
    writeFileSync(input, JSON.stringify({ ...selected, cursor }));
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "read", directory, input],
      {
        env,
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: LIMITS.pageBytes + 4096,
      },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.signal, null);
    assert.equal(child.stderr, "");
    const result = JSON.parse(child.stdout);
    pages.push(result);
    if (result.status !== "page" || !result.page.next) break;
    assert.notDeepEqual(result.page.next, cursor);
    cursor = result.page.next;
  }
  // Exact current codec: callers can recompute a "proof completed" position.
  // This is NOT accepted as proof by current production validation.
  const claimed = {
    pos: { segment: 2, offset: 0 },
    row: 0,
    event: 0,
    byte: 0,
    snapshot: LIMITS.segmentBytes + 1,
  };
  const forged = scanCursor(cursor, claimed);
  assert.deepEqual(parseScanCursor(forged), claimed);
  const freshReader = HistoryReader.open(c);
  assert.ok(freshReader);
  let forgedFailure: unknown;
  try {
    await searchHistory(freshReader, forged);
  } catch (error) {
    forgedFailure =
      error && typeof error === "object" && "code" in error
        ? error.code
        : "unexpected";
  }
  assert.equal(forgedFailure, "corrupt-selected");
  const budget = new HistoryReadBudget();
  const reservations: { bytes: number; chargedBefore: number }[] = [];
  const reserve = budget.reserve.bind(budget);
  budget.reserve = (bytes) => {
    reservations.push({ bytes, chargedBefore: budget.bytes });
    return reserve(bytes); // Observation only; original limits/time unchanged.
  };
  let proofFailure: unknown;
  try {
    files.validateRecovery(bridge.value, budget);
  } catch (error) {
    proofFailure =
      error && typeof error === "object" && "code" in error
        ? error.code
        : "unexpected";
  }
  assert.deepEqual(ledgerIdentity(files), before);
  assert.deepEqual(storedTree(files.directory), treeBefore);
  const last = pages.at(-1),
    hits = pages.flatMap((p) => (p.status === "page" ? p.page.hits : []));
  const receipt = {
    featureComplete:
      last?.status === "page" &&
      last.page.next === null &&
      hits.length === 1 &&
      hits[0].owner.taskId === selected.taskId &&
      hits[0].range.start === 0 &&
      hits[0].range.end === Buffer.byteLength("progress-target") &&
      hits[0].content.sha256 === digest(Buffer.from("progress-target")),
    classification:
      "real filesystem/native restart counterexample; fabricated management authority; not feature acceptance",
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    originalProducer: {
      exitCode: original.status,
      signal: original.signal,
      forced: false,
    },
    predecessorBytes: predecessor.length,
    bridgeBytes: readFileSync(files.segmentPath(2)).length,
    originalRawProofMinimum:
      predecessor.length + readFileSync(files.segmentPath(2)).length,
    readLimit: LIMITS.searchBytes,
    readTimeLimit: LIMITS.searchMs,
    predecessorHash: digest(predecessor),
    bridgeHash: before["000000000002.jsonl"],
    originalHighSeq: bridge.value.previous.highSeq,
    originalCommittedBytes: bridge.value.previous.committedBytes,
    fullAdministrativeScanAccepted: state.committedSeq === marker.last,
    cursorClaimRecomputed: true,
    forgedFailure,
    proofFailure,
    reservations,
    pages,
    retainedLedgerUnchanged: true,
    entireHistoryTreeUnchanged: true,
  };
  writeFileSync(
    join(directory, "receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  process.stdout.write(
    JSON.stringify(
      {
        ...receipt,
        pages: pages.length,
        reservations: reservations.filter((v) => v.bytes),
      },
      null,
      2,
    ),
  );
  if (receipt.featureComplete) {
    for (const format of ["ndjson", "markdown"]) {
      const input = join(directory, `export-${format}.json`);
      writeFileSync(input, JSON.stringify({ ...selected, cursor, format }));
      const child = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "export", directory, input],
        { env, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 },
      );
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.signal, null);
      assert.equal(child.stderr, "");
      writeFileSync(
        join(directory, `export-${format}-receipt.json`),
        child.stdout,
      );
    }
    let detailCursor = hits[0].cursor;
    let detail: import("../../src/service-contract.ts").DetailPage | undefined;
    for (let n = 0; n < 1000; n++) {
      const input = join(directory, `detail-${n}.json`);
      writeFileSync(
        input,
        JSON.stringify({ ...selected, cursor: detailCursor }),
      );
      const child = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "detail", directory, input],
        { env, encoding: "utf8", timeout: 15000, maxBuffer: LIMITS.pageBytes },
      );
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.signal, null);
      assert.equal(child.stderr, "");
      const result = JSON.parse(child.stdout);
      assert.equal(result.status, "page", JSON.stringify(result));
      if (result.page.kind !== "progress") {
        detail = result.page;
        break;
      }
      assert.notDeepEqual(result.page.next, detailCursor);
      detailCursor = result.page.next;
    }
    assert.equal(detail?.text, "progress-target");
    assert.equal(
      detail?.content.sha256,
      digest(Buffer.from("progress-target")),
    );
    assert.deepEqual(storedTree(files.directory), treeBefore);
  }
  // Deliberately non-green: the requested complete search, not a refusal assertion.
  if (!receipt.featureComplete) process.exitCode = 1;
} else throw Error("Unknown fixture mode");
