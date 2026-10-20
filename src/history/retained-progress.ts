/** Finite authenticated traversal state. This module owns structural decoding;
 * AEAD and the forward validator separately own authenticity and source proof. */
import {
  type CaptureCoverage,
  ContractError,
  decodeCoverage,
  LIMITS,
} from "../service-contract.ts";
import { bool, closed, integer, oneOf, text } from "../worker-public.mjs";
import type { Pointer } from "./navigation.ts";
import { COMPLETE } from "./types.ts";
import {
  decodeValidator,
  freshValidator,
  type ValidatorState,
} from "./validator.ts";

export interface BatchWitness {
  pointer: Pointer;
  stamp: string;
  sha256: string;
}
export interface EndWitness extends BatchWitness {
  row: number;
  event: number;
}
export interface RetainedProgress {
  v: 1;
  phase: "snapshot" | "output" | "finish" | "done";
  proof: ValidatorState;
  snapshot: BatchWitness | null;
  end: EndWitness | null;
  admission: EndWitness | null;
  admissionMissing: boolean;
  work: null | {
    kind: "end" | "overlap" | "admission";
    target: string;
    proof: ValidatorState;
    row: number;
    event: number;
    overlap: string;
    offset: number;
    length: number;
  };
  coverage: CaptureCoverage;
}
export function freshProgress(): RetainedProgress {
  return {
    v: 1,
    phase: "snapshot",
    proof: freshValidator(),
    snapshot: null,
    end: null,
    admission: null,
    admissionMissing: false,
    work: null,
    coverage: { ...COMPLETE, omissions: [] },
  };
}
export function decodeWitness(
  value: unknown,
  end = false,
): EndWitness | BatchWitness {
  const o = closed(value, [
      "pointer",
      "stamp",
      "sha256",
      ...(end ? ["row", "event"] : []),
    ]),
    p = closed(o.pointer, ["segment", "offset", "bytes", "seq"]);
  const n = integer(Number(p.seq), 1);
  if (String(n) !== p.seq) throw new ContractError("corrupt-selected");
  const pointer = {
    segment: integer(p.segment, 1, 999999999999),
    offset: integer(p.offset, 0, LIMITS.segmentBytes),
    bytes: integer(p.bytes, 1, LIMITS.segmentBytes),
    seq: String(n),
  };
  if (pointer.offset + pointer.bytes > LIMITS.segmentBytes)
    throw new ContractError("corrupt-selected");
  const sha256 = text(o.sha256, 64, true);
  if (!/^[a-f0-9]{64}$/.test(sha256))
    throw new ContractError("corrupt-selected");
  return {
    pointer,
    stamp: text(o.stamp, 256, true),
    sha256,
    ...(end
      ? {
          row: integer(o.row, 0, LIMITS.segmentRecords - 1),
          event: integer(o.event, 0, LIMITS.ownerQueueFrames - 1),
        }
      : {}),
  };
}
export function decodeRetainedProgress(value: unknown): RetainedProgress {
  const o = closed(value, [
    "v",
    "phase",
    "proof",
    "snapshot",
    "end",
    "admission",
    "admissionMissing",
    "work",
    "coverage",
  ]);
  if (o.v !== 1) throw new ContractError("corrupt-selected");
  const result: RetainedProgress = {
    v: 1,
    phase: oneOf(o.phase, ["snapshot", "output", "finish", "done"]),
    proof: decodeValidator(o.proof),
    snapshot: o.snapshot === null ? null : decodeWitness(o.snapshot),
    end: o.end === null ? null : (decodeWitness(o.end, true) as EndWitness),
    admission:
      o.admission === null
        ? null
        : (decodeWitness(o.admission, true) as EndWitness),
    admissionMissing: bool(o.admissionMissing),
    work: null,
    coverage: decodeCoverage(o.coverage),
  };
  if (o.work !== null) {
    const w = closed(o.work, [
      "kind",
      "target",
      "proof",
      "row",
      "event",
      "overlap",
      "offset",
      "length",
    ]);
    result.work = {
      kind: oneOf(w.kind, ["end", "overlap", "admission"]),
      target: text(w.target, 64, true),
      proof: decodeValidator(w.proof),
      row: integer(w.row, 0, LIMITS.segmentRecords),
      event: integer(w.event, 0, LIMITS.ownerQueueFrames),
      overlap: text(w.overlap, 1364),
      offset: integer(w.offset, 0, LIMITS.detailBytes),
      length: integer(w.length, 0, 1023),
    };
    const b = Buffer.from(result.work.overlap, "base64url");
    if (
      !/^[a-f0-9]{64}$/.test(result.work.target) ||
      b.toString("base64url") !== result.work.overlap ||
      b.length > result.work.length ||
      (result.work.kind !== "overlap" &&
        (b.length || result.work.offset || result.work.length))
    )
      throw new ContractError("corrupt-selected");
  }
  if (
    (result.phase === "snapshot" &&
      (result.snapshot ||
        result.end ||
        result.admission ||
        result.admissionMissing ||
        result.work)) ||
    (result.work &&
      (result.phase !== "output" || result.proof.phase !== "ready"))
  )
    throw new ContractError("corrupt-selected");
  return result;
}
