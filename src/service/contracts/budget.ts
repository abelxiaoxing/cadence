import {
  type CaptureBudget,
  decodeCaptureBudget,
  decodeRecordingInput,
  type PublicRecordingInput,
} from "./capture.ts";
import { ContractError, canonicalJson, LIMITS, utf8Bytes } from "./core.ts";
import {
  decodeOwnerRecordingInput,
  type OwnerRecordingInput,
} from "./history.ts";

/** Resource accounting only: no persistence, accepting sink, scheduler or timer.
 * One instance per W3 child/owner ingress. The caller must reserve BEFORE copying
 * source values. Bytes mean encoded-data/retention budgets, not total JS heap.
 */
export class CaptureBudgetPool {
  private leases = new Set<CaptureBudgetLease>();
  reserve(input: CaptureBudget): CaptureBudgetLease {
    const budget = decodeCaptureBudget(input);
    const lease = new CaptureBudgetLease(
      (next) => this.check(lease, next),
      () => {
        this.leases.delete(lease);
      },
      budget,
    );
    this.check(lease, budget);
    this.leases.add(lease);
    return lease;
  }
  get accounting(): {
    leases: number;
    bytes: number;
    sourceFrames: number;
    outputChunks: number;
  } {
    const values = [...this.leases].map((l) => l.budget);
    return {
      leases: values.length,
      bytes: values.reduce((n, b) => n + b.retainedBytes + b.outputBytes, 0),
      sourceFrames: values.reduce((n, b) => n + b.sourceFrames, 0),
      outputChunks: values.reduce((n, b) => n + b.outputChunks, 0),
    };
  }
  /** Internal lease update: replacement is checked before any accounting mutation. */
  private check(lease: CaptureBudgetLease, budget: CaptureBudget): void {
    const values = [...this.leases]
      .filter((l) => l !== lease)
      .map((l) => l.budget)
      .concat(budget);
    const fits = (items: CaptureBudget[], bytes: number, frames: number) =>
      items.reduce((n, b) => n + b.retainedBytes + b.outputBytes, 0) <= bytes &&
      // Source and transformed events share the SAME frame ceiling while both
      // are retained. A prefix-only/empty lease still occupies one slot.
      items.reduce(
        (n, b) => n + Math.max(1, b.sourceFrames + b.outputChunks),
        0,
      ) <= frames;
    if (
      !fits(values, LIMITS.ownerQueueBytes, LIMITS.ownerQueueFrames) ||
      !fits(
        values.filter((b) => b.lane === "data"),
        LIMITS.ownerQueueBytes - LIMITS.ownerControlBytes,
        LIMITS.ownerQueueFrames - LIMITS.ownerControlFrames,
      )
    )
      throw new ContractError("capacity");
  }
}
class CaptureBudgetLease {
  private state: "reserved" | "in-flight" | "released" = "reserved";
  constructor(
    private readonly resize: (budget: CaptureBudget) => void,
    private readonly forget: () => void,
    private value: CaptureBudget,
  ) {}
  get budget(): CaptureBudget {
    return { ...this.value };
  }
  grow(input: CaptureBudget): void {
    if (this.state !== "reserved") throw new ContractError("conflict");
    const extra = decodeCaptureBudget(input);
    if (extra.lane !== this.value.lane) throw new ContractError("invalid");
    const next = decodeCaptureBudget({
      lane: extra.lane,
      sourceFrames: extra.sourceFrames + this.value.sourceFrames,
      retainedBytes: extra.retainedBytes + this.value.retainedBytes,
      outputBytes: extra.outputBytes + this.value.outputBytes,
      outputChunks: extra.outputChunks + this.value.outputChunks,
    });
    this.resize(next);
    this.value = next;
  }
  beginWorker(input: PublicRecordingInput): PublicRecordingInput {
    if (this.state !== "reserved") throw new ContractError("conflict");
    this.size(input);
    const value = decodeRecordingInput(input);
    this.chunks(value.events.length);
    if (
      this.value.lane === "control" &&
      value.events.some(
        (e) =>
          !["ready", "capture-status", "worker-failure", "final"].includes(
            e.event.kind,
          ),
      )
    )
      throw new ContractError("invalid");
    this.state = "in-flight";
    return value;
  }
  beginOwner(input: OwnerRecordingInput): OwnerRecordingInput {
    if (this.state !== "reserved") throw new ContractError("conflict");
    this.size(input);
    const value = decodeOwnerRecordingInput(input);
    this.chunks(value.events.length);
    if (
      this.value.sourceFrames !== 0 ||
      (this.value.lane === "control" &&
        value.events.some((e) => e.kind !== "fact"))
    )
      throw new ContractError("invalid");
    this.state = "in-flight";
    return value;
  }
  private size(input: unknown): void {
    // No unreserved decoded copy is retained: check encoded output ceiling first.
    if (
      utf8Bytes(canonicalJson(input, this.value.outputBytes)) >
      this.value.outputBytes
    )
      throw new ContractError("capacity");
  }
  private chunks(count: number): void {
    if (count > this.value.outputChunks) throw new ContractError("capacity");
  }
  release(): void {
    if (this.state !== "reserved") throw new ContractError("conflict");
    this.state = "released";
    this.forget();
  }
  settled(): void {
    if (this.state !== "in-flight") throw new ContractError("conflict");
    this.state = "released";
    this.forget();
  }
}
