/** Fair reader/writer checkout gate for current conversations and workflows.
 * It owns no tasks, graphs, model choice, process launcher or history writer. */
import { ContractError, decodeId } from "../service-contract.ts";
import type { ServiceOwner } from "./owner.ts";

/** Waiting requests only; shared holders have a separate bounded reservation. */
export const CHECKOUT_WAITERS = 16;
export const CHECKOUT_READERS = 4;
export type CheckoutAccess = "shared" | "exclusive";
export interface CheckoutPermit {
  assertHeld(): void;
  /** Trusted execution calls this only after its ORIGINAL operations settle.
   * An abort/timeout is not settlement; quarantine never releases the holder. */
  release(): void;
}
interface Waiter {
  id: string;
  access: CheckoutAccess;
  resolve(permit: CheckoutPermit): void;
  reject(error: unknown): void;
}
export class CheckoutGate {
  private readonly waiting: Waiter[] = [];
  private readonly holders = new Set<Waiter>();
  private closed = false;
  constructor(
    private readonly owner: Pick<ServiceOwner, "state"> & {
      lease: Pick<ServiceOwner["lease"], "assert">;
    },
  ) {}
  private assertOpen(): void {
    this.owner.lease.assert();
    if (this.closed || this.owner.state !== "idle")
      throw new ContractError("quarantine");
  }
  assertQuiescent(): void {
    this.assertOpen();
    if (this.holders.size || this.waiting.length)
      throw new ContractError("conflict");
  }
  acquire(
    id: string,
    signal: AbortSignal,
    access: CheckoutAccess = "exclusive",
  ): Promise<CheckoutPermit> {
    decodeId(id);
    this.assertOpen();
    if (signal.aborted) throw new ContractError("stale");
    if ([...this.holders, ...this.waiting].some((w) => w.id === id))
      throw new ContractError("conflict");
    if (this.waiting.length >= CHECKOUT_WAITERS)
      throw new ContractError("capacity");
    const result = new Promise<CheckoutPermit>((resolve, reject) => {
      const abort = () => {
        const at = this.waiting.indexOf(waiter);
        if (at >= 0) {
          this.waiting.splice(at, 1)[0].reject(new ContractError("stale"));
          this.pump();
        }
      };
      const waiter: Waiter = {
        id,
        access,
        resolve: (permit) => {
          signal.removeEventListener("abort", abort);
          resolve(permit);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      };
      this.waiting.push(waiter);
      signal.addEventListener("abort", abort, { once: true });
    });
    this.pump();
    return result;
  }
  closeAdmission(): void {
    this.closed = true;
    for (const w of this.waiting.splice(0))
      w.reject(new ContractError("quarantine"));
    // Original holders remain held. Stop/quarantine is not a refund.
  }
  private pump(): void {
    if (this.closed || !this.waiting.length) return;
    try {
      this.assertOpen();
    } catch {
      this.closeAdmission();
      return;
    }
    while (this.waiting.length) {
      const waiter = this.waiting[0];
      if (
        this.holders.size >= CHECKOUT_READERS ||
        [...this.holders].some((w) => w.access === "exclusive") ||
        (waiter.access === "exclusive" && this.holders.size)
      )
        return;
      this.waiting.shift();
      this.holders.add(waiter);
      const assertHeld = () => {
        this.assertOpen();
        // Object identity prevents an old handle from releasing a reused ID.
        if (!this.holders.has(waiter)) throw new ContractError("stale");
      };
      waiter.resolve({
        assertHeld,
        release: () => {
          assertHeld();
          this.holders.delete(waiter);
          this.pump();
        },
      });
    }
  }
}
