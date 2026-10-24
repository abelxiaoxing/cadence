import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { HistoryFiles, HistoryReadBudget } from "../src/history/files.ts";
import { HistoryReadProof } from "../src/history/read-proof.ts";
import { HistoryRecovery } from "../src/history/recovery.ts";
import { encodeJournalText } from "../src/history/types.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { inspectRecovery } from "../src/service/recovery.ts";
import {
  canonicalJson,
  decodeEntityReadResult,
  decodeHistoryReadResult,
  type EntityReadRequest,
  type HistoryRecord,
  LIMITS,
  type ListRequest,
} from "../src/service-contract.ts";
import { storedTree } from "./helpers/history-read-fixture.ts";

let directory: string,
  bundle: string,
  selected: {
    root: string;
    state: string;
    epoch: string;
    taskId: string;
    runTaskId: string;
    runId: string;
    message: string;
    call: string;
    orphan: string;
    expected: Record<string, HistoryRecord[]>;
  },
  files: HistoryFiles,
  snapshot: string,
  before: [string, string][];
const readers = [
  "tasks",
  "runs",
  "messages",
  "tools",
  "contents",
  "events",
  "checks",
  "changes",
  "reviews",
] as const;
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "cadence-list-entity-"));
  bundle = join(directory, "read.mjs");
  const produce = join(directory, "produce.mjs");
  for (const [source, target] of [
    ["history-read-child.ts", bundle],
    ["history-list-archive.ts", produce],
  ]) {
    const built = spawnSync(
      "bun",
      [
        "build",
        fileURLToPath(new URL(`./helpers/${source}`, import.meta.url)),
        "--target=node",
        "--packages=external",
        "--outfile",
        target,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(built.status, built.stderr).toBe(0);
  }
  const child = spawnSync(process.execPath, [produce, directory], {
    encoding: "utf8",
    timeout: 15000,
  });
  expect(child.status, child.stderr).toBe(77);
  expect(child.signal).toBeNull();
  selected = JSON.parse(readFileSync(join(directory, "selected.json"), "utf8"));
  const c = new ServiceCoordination(selected.root, selected.state);
  const opened = HistoryFiles.open(c);
  if (!opened) throw Error("missing fixture");
  files = opened;
  const original = readFileSync(files.segmentPath(1));
  expect(original.length).toBe(LIMITS.segmentBytes);
  const recovery = new HistoryRecovery(c);
  for (let n = 0; n < 2; n++) {
    if (n)
      appendFileSync(
        files.segmentPath(2),
        `${encodeJournalText({ kind: "record", id: randomUUID(), seq: String(BigInt(snapshot) + 1n), value: { kind: "owner-epoch", epoch: randomUUID() } })}{"torn":`,
      );
    const expected = await inspectRecovery(c, recovery);
    expect(expected.owner).toBe("absent");
    const fact = await recovery.append({
      expected,
      acknowledgeEscapedProcesses: true,
      processes: "externally-resolved",
      credentials: "independently-resolved",
      storage: "independently-resolved",
      assertLocalAuthority: (choice) => expect(choice).toEqual(expected),
    });
    snapshot = fact.committedSeq;
  }
  // Byte comparison: a deep toEqual walks an 8MiB Buffer key by key and
  // needs about 2.5GB of heap, past V8's default limit on smaller hosts.
  expect(readFileSync(files.segmentPath(1)).equals(original)).toBe(true);
  renameSync(
    join(files.directory, "indexes"),
    join(directory, "preserved-indexes"),
  );
  mkdirSync(join(files.directory, "indexes", "heads"), {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(
    join(files.directory, "indexes", "heads", "latest.json"),
    '{"bad":"preserved"}',
    { mode: 0o600 },
  );
  before = storedTree(files.directory);
}, 90000);
function native(
  mode: "list" | "entity",
  request: ListRequest | EntityReadRequest,
) {
  const input = join(directory, "input.json");
  writeFileSync(input, JSON.stringify({ ...selected, mode, request }));
  const child = spawnSync(process.execPath, [bundle, input], {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: LIMITS.pageBytes,
  });
  expect(child.status, child.stderr).toBe(0);
  expect(child.signal).toBeNull();
  expect(child.stderr).toBe("");
  expect(Buffer.byteLength(child.stdout)).toBeLessThanOrEqual(LIMITS.pageBytes);
  return JSON.parse(child.stdout);
}
const seed = (reader: ListRequest["reader"], exact: boolean): ListRequest => ({
  reader,
  storeId: files.format.storeId,
  scope:
    reader === "tasks"
      ? { kind: "workspace", id: files.format.workspaceId }
      : { kind: "run", id: selected.runId },
  snapshotSeq: exact ? snapshot : null,
  after: null,
  limit: 3,
});
it.each(readers)(
  "cold %s lists discover the actual head and preserve exact snapshot/order/versions",
  (reader) => {
    for (const exact of [false, true]) {
      let request = seed(reader, exact),
        progress = 0,
        transitions = 0,
        done = false;
      const records: HistoryRecord[] = [];
      for (let n = 0; n < 1000; n++) {
        const result = decodeHistoryReadResult(native("list", request));
        expect(result.request).toEqual(request);
        if ("kind" in result) {
          progress++;
          if (result.kind === "snapshot") {
            transitions++;
            expect(result.next.snapshotSeq).toBe(snapshot);
            expect(request.snapshotSeq).toBeNull();
          } else expect(result.next.snapshotSeq).toBe(request.snapshotSeq);
          const proof = new HistoryReadProof(files);
          const plaintext = proof
            .open(
              { purpose: "list", request: result.next },
              result.next.navigation!,
              new HistoryReadBudget(),
            )
            .toString();
          expect(Buffer.byteLength(plaintext)).toBeLessThanOrEqual(6000);
          if (request.navigation)
            expect(plaintext).not.toBe(
              proof
                .open(
                  { purpose: "list", request },
                  request.navigation,
                  new HistoryReadBudget(),
                )
                .toString(),
            );
        } else {
          expect(result.request.snapshotSeq).toBe(snapshot);
          records.push(...result.records);
        }
        if (!result.next) {
          done = true;
          break;
        }
        request = result.next;
      }
      expect(done).toBe(true);
      expect(progress).toBeGreaterThan(0);
      expect(transitions).toBe(exact ? 0 : 1);
      if (reader === "tasks")
        expect(records).toMatchObject([
          {
            kind: "task",
            version: 1,
            owner: { taskId: selected.taskId },
            goal: "late task retained",
          },
        ]);
      else expect(records).toEqual(selected.expected[reader]);
      expect(new Set(records.map((r) => canonicalJson(r))).size).toBe(
        records.length,
      );
    }
    expect(storedTree(files.directory)).toEqual(before);
  },
  120000,
);
it.each([
  ["task", "taskId", 1],
  ["message", "message", 1],
  ["message", "message", 2],
  ["tool", "call", 1],
  ["tool", "call", 2],
  ["tool", "orphan", 1],
] as const)(
  "cold exact %s/%s/%i remains reachable after long index-free lookup",
  (kind, key, version) => {
    const id = selected[key];
    let request: EntityReadRequest = {
        storeId: files.format.storeId,
        scope: {
          kind: "task",
          id: kind === "task" ? selected.taskId : selected.runTaskId,
        },
        snapshotSeq: snapshot,
        kind,
        id,
        version,
      },
      done = false,
      progress = 0;
    for (let n = 0; n < 1000; n++) {
      const result = decodeEntityReadResult(native("entity", request));
      expect(result.request).toEqual(request);
      if (!("kind" in result)) {
        expect(result.record.version).toBe(version);
        expect(result.record.owner.entity.id).toBe(id);
        done = true;
        break;
      }
      progress++;
      request = result.next;
    }
    expect(done).toBe(true);
    expect(progress).toBeGreaterThan(0);
    expect(storedTree(files.directory)).toEqual(before);
  },
  120000,
);
