/** Writer-issued per-task fold checkpoints: an optional accelerator over a task's
 * original entity chain, never acceptance, recovery or repair authority. One is
 * written after a batch settling that task's publication commits, anchored to
 * the task's chain head at that batch and authenticated with a key derived from
 * the store's private read-proof key. Readers fold only the newer original
 * batches on top. A missing, foreign, moved or unauthenticated checkpoint is
 * ignored and the original chain is folded; budget exhaustion is never absence. */
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../service-contract.ts";
import {
  closed,
  decodeHash,
  decodeId,
  decodeSequence,
  literal,
  text,
} from "../worker-public.mjs";
import type { HistoryFiles, HistoryReadBudget } from "./files.ts";
import type { HistoryNavigation, LocatedBatch } from "./navigation.ts";

const SCHEMA = "cadence-task-fold/1";
/** Each part is decoded by its own fold; this module only seals and opens. */
export interface TaskFoldBody {
  checks: unknown;
  run: unknown;
  plan: unknown;
}
export interface TaskFoldAnchor {
  seq: string;
  hash: string;
}
function sign(
  files: HistoryFiles,
  record: unknown,
  budget?: HistoryReadBudget,
): Buffer {
  const material = files.readProofMaterial(budget);
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      material.key,
      Buffer.from(files.format.storeId, "utf8"),
      Buffer.from(SCHEMA, "utf8"),
      32,
    ),
  );
  return createHmac("sha256", key).update(canonicalJson(record)).digest();
}
export function sealTaskFold(
  files: HistoryFiles,
  taskId: string,
  anchor: TaskFoldAnchor,
  body: TaskFoldBody,
): unknown {
  const record = {
    schema: SCHEMA,
    storeId: files.format.storeId,
    taskId: decodeId(taskId),
    seq: decodeSequence(anchor.seq),
    hash: decodeHash(anchor.hash),
    body,
  };
  return { ...record, mac: sign(files, record).toString("base64url") };
}
export function openTaskFold(
  files: HistoryFiles,
  value: unknown,
  taskId: string,
  anchor: TaskFoldAnchor,
  budget: HistoryReadBudget,
): TaskFoldBody | undefined {
  try {
    const o = closed(value, [
      "schema",
      "storeId",
      "taskId",
      "seq",
      "hash",
      "body",
      "mac",
    ]);
    literal(o.schema, SCHEMA);
    if (
      decodeId(o.storeId) !== files.format.storeId ||
      decodeId(o.taskId) !== taskId ||
      decodeSequence(o.seq) !== anchor.seq ||
      decodeHash(o.hash) !== anchor.hash
    )
      return;
    const part = closed(o.body, ["checks", "run", "plan"]),
      body: TaskFoldBody = {
        checks: part.checks,
        run: part.run,
        plan: part.plan,
      };
    const given = Buffer.from(text(o.mac, 43, true), "base64url");
    const expected = sign(
      files,
      {
        schema: SCHEMA,
        storeId: o.storeId,
        taskId: o.taskId,
        seq: o.seq,
        hash: o.hash,
        body,
      },
      budget,
    );
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return;
    return body;
  } catch {
    budget.reserve(0); // Exhaustion stays inconclusive, never a missing checkpoint.
    return;
  }
}
/** One fold part through `snapshot`: the newest valid checkpoint's decoded
 * part and the newer original batches, or no base and the original chain (or
 * snapshot scan). An undecodable part is an absent checkpoint, not a refusal. */
export function resumeTaskFold<T>(
  files: HistoryFiles,
  navigation: HistoryNavigation,
  taskId: string,
  snapshot: string,
  budget: HistoryReadBudget,
  decode: (body: TaskFoldBody) => T,
): { base: T | undefined; batches: Iterable<LocatedBatch> } {
  const suffix = navigation.taskSuffix(
    taskId,
    snapshot,
    budget,
    (value, head) => {
      const body = openTaskFold(files, value, taskId, head, budget);
      if (!body) return;
      try {
        return decode(body);
      } catch {
        budget.reserve(0); // Exhaustion while resuming is never an absent part.
        return;
      }
    },
  );
  return (
    suffix ?? {
      base: undefined,
      batches:
        navigation.entityBatches(taskId, snapshot, budget) ??
        navigation.scanSnapshot(snapshot, budget),
    }
  );
}
