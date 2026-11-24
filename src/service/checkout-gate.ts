/** Exclusive access to one checkout directory, for the few operations that
 * write a user's working files: a working-copy delivery for its whole run, a
 * target-placement setup command, and bringing a checked-out branch along
 * when a delivery lands. Isolated implementation, verification, research and
 * waiting to land hold nothing. Waiters are served in arrival order and are
 * not counted. It owns no tasks, graphs, model choice or process launcher. */
import { ContractError, decodeId } from "../service-contract.ts";
import type { ServiceOwner } from "./owner.ts";

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
interface Lane {
  holder: Waiter | null;
  waiting: Waiter[];
}
export class CheckoutGate {
  private readonly lanes = new Map<string, Lane>();
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
    if (this.lanes.size) throw new ContractError("conflict");
  }
  /** `checkout` is the canonical directory whose working files are written. */
  acquire(
    checkout: string,
    id: string,
    signal: AbortSignal,
  ): Promise<CheckoutPermit> {
    decodeId(id);
    this.assertOpen();
    if (signal.aborted) throw new ContractError("stale");
    let lane = this.lanes.get(checkout);
    if (!lane) {
      lane = { holder: null, waiting: [] };
      this.lanes.set(checkout, lane);
    }
    const active = lane;
    if ([active.holder, ...active.waiting].some((w) => w?.id === id))
      throw new ContractError("conflict");
    const result = new Promise<CheckoutPermit>((resolve, reject) => {
      const abort = () => {
        const at = active.waiting.indexOf(waiter);
        if (at >= 0) {
          active.waiting.splice(at, 1)[0].reject(new ContractError("stale"));
          this.pump(checkout, active);
        }
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
      active.waiting.push(waiter);
      signal.addEventListener("abort", abort, { once: true });
    });
    this.pump(checkout, active);
    return result;
  }
  closeAdmission(): void {
    this.closed = true;
    for (const [checkout, lane] of this.lanes) {
      for (const w of lane.waiting.splice(0))
        w.reject(new ContractError("quarantine"));
      // Original holders remain held. Stop/quarantine is not a refund.
      if (!lane.holder) this.lanes.delete(checkout);
    }
  }
  private pump(checkout: string, lane: Lane): void {
    if (!this.closed && !lane.holder && lane.waiting.length) {
      try {
        this.assertOpen();
      } catch {
        this.closeAdmission();
        return;
      }
      const waiter = lane.waiting.shift() as Waiter;
      lane.holder = waiter;
      const assertHeld = () => {
        this.assertOpen();
        // Object identity prevents an old handle from releasing a reused ID.
        if (lane.holder !== waiter) throw new ContractError("stale");
      };
      waiter.resolve({
        assertHeld,
        release: () => {
          assertHeld();
          lane.holder = null;
          this.pump(checkout, lane);
        },
      });
    }
    if (
      !lane.holder &&
      !lane.waiting.length &&
      this.lanes.get(checkout) === lane
    )
      this.lanes.delete(checkout);
  }
}
