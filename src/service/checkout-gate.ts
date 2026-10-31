/** One exclusive checkout gate for current conversations and workflows.
 * It owns no tasks, graphs, model choice, process launcher or history writer. */
import { ContractError, decodeId } from "../service-contract.ts";
import type { ServiceOwner } from "./owner.ts";

/** Waiting requests only; one additional request may hold the checkout. */
export const CHECKOUT_WAITERS = 16;
export interface CheckoutPermit {
  assertHeld(): void;
  /** Trusted execution calls this only after its ORIGINAL operations settle.
   * An abort/timeout is not settlement; quarantine never releases the holder. */
  release(): void;
}
interface Waiter {
  id: string;
  resolve(permit: CheckoutPermit): void;
  reject(error: unknown): void;
}
export class CheckoutGate {
  private readonly waiting: Waiter[] = [];
  private holder: Waiter | null = null;
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
    if (this.holder || this.waiting.length) throw new ContractError("conflict");
  }
  acquire(id: string, signal: AbortSignal): Promise<CheckoutPermit> {
    decodeId(id);
    this.assertOpen();
    if (signal.aborted) throw new ContractError("stale");
    if (this.holder?.id === id || this.waiting.some((w) => w.id === id))
      throw new ContractError("conflict");
    if (this.waiting.length >= CHECKOUT_WAITERS)
      throw new ContractError("capacity");
    const result = new Promise<CheckoutPermit>((resolve, reject) => {
      const abort = () => {
        const at = this.waiting.indexOf(waiter);
        if (at >= 0)
          this.waiting.splice(at, 1)[0].reject(new ContractError("stale"));
      };
      const waiter: Waiter = {
        id,
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
    // The original holder remains held. Stop/quarantine is not a refund.
  }
  private pump(): void {
    if (this.closed || this.holder || !this.waiting.length) return;
    try {
      this.assertOpen();
    } catch {
      this.closeAdmission();
      return;
    }
    const waiter = this.waiting.shift();
    if (!waiter) return;
    this.holder = waiter;
    const assertHeld = () => {
      this.assertOpen();
      // Object identity prevents an old handle from releasing a reused ID.
      if (this.holder !== waiter) throw new ContractError("stale");
    };
    waiter.resolve({
      assertHeld,
      release: () => {
        assertHeld();
        this.holder = null;
        this.pump();
      },
    });
  }
}
