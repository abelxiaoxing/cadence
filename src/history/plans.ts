/** Prospective plan identities are proposals, never proof of stored membership. */
import { createHash, randomUUID } from "node:crypto";
import {
  type ContentRef,
  ContractError,
  decodeContentRef,
  type Graph,
  LIMITS,
  type OwnerRecordingInput,
} from "../service-contract.ts";
import { text } from "../worker-public.mjs";
import { sanitizeText } from "../worker-redaction.mjs";

export function assertPlanContent(
  plan: string,
  reference: ContentRef,
  secrets: readonly string[],
): void {
  text(plan, 32768);
  const ref = decodeContentRef(reference);
  if (
    ref.field !== "plan" ||
    ref.bytes !== Buffer.byteLength(plan) ||
    ref.sha256 !== createHash("sha256").update(plan).digest("hex") ||
    sanitizeText(plan, secrets) !== plan
  )
    throw new ContractError("invalid");
}

/** Local proposal construction only: no filesystem, auth, publication or launch. */
export function proposePlanContent(
  plan: string,
  version: number,
  secrets: readonly string[],
): ContentRef {
  text(plan, 32768);
  const reference = decodeContentRef({
    recordId: randomUUID(),
    version,
    field: "plan",
    bytes: Buffer.byteLength(plan),
    sha256: createHash("sha256").update(plan).digest("hex"),
  });
  assertPlanContent(plan, reference, secrets);
  return reference;
}

/** Historical published metadata, not current action authority. */
export interface PublishedPlan {
  operationId: string;
  graph: Graph;
  reference: { recordId: string; revision: number; sha256: string };
  publication: { revision: number; identity: string };
  committedSeq: string;
}

/** Internal common event builder; caller must first prove accepted operation/bytes. */
export function planRecording(
  plan: string,
  graph: Graph,
  operationId: string,
  epoch: string,
): OwnerRecordingInput {
  const detailId = randomUUID();
  const input: OwnerRecordingInput = {
    link: { epoch, taskId: graph.taskId, runId: null, operationId },
    observedMs: 0,
    events: [
      {
        kind: "content-begin",
        detailId,
        owner: {
          taskId: graph.taskId,
          runId: null,
          childRunId: null,
          entity: {
            kind: "task",
            id: graph.taskId,
            version: graph.planRevision,
          },
        },
        field: "plan",
        encoding: "utf8",
      },
    ],
  };
  const bytes = Buffer.from(plan);
  for (let at = 0; at < bytes.length; ) {
    let end = Math.min(at + LIMITS.chunkBytes, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    input.events.push({
      kind: "content-chunk",
      detailId,
      text: bytes.subarray(at, end).toString("utf8"),
    });
    at = end;
  }
  input.events.push({
    kind: "content-end",
    detailId,
    coverage: {
      observed: "complete",
      source: "complete",
      redacted: false,
      omissions: [],
    },
  });
  return input;
}
