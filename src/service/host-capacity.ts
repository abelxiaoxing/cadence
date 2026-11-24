/** Admission of host-heavy shell work by what this machine can take right now.
 * Nothing is counted against a configured limit and nothing is refused: a step
 * that does not fit waits, and steps are admitted in arrival order. A waiting
 * step leaves only through its own abort signal, which the owner raises for
 * every run it stops. It starts no process and knows nothing about a step. */
import { availableParallelism, freemem } from "node:os";
import { ContractError } from "./contracts/core.ts";

export interface HostCost {
  /** Cores the step is assumed to keep busy. */
  cores: number;
  /** Memory the step is assumed to need. */
  bytes: number;
}
const GIB = 1024 ** 3;
/** A heavy check is a whole-project suite that fans out by itself; every other
 * shell step (setup, build, an ordinary check) is one process tree. */
export const HOST_COST = {
  light: { cores: 1, bytes: GIB / 2 },
  heavy: { cores: 4, bytes: 2 * GIB },
} as const satisfies Record<string, HostCost>;
/** Memory left alone for everything else on the machine. */
export const HOST_RESERVE_BYTES = GIB;
/** Memory can free up without any of our steps ending. */
const RECHECK_MS = 1000;

export interface HostProbe {
  cores(): number;
  memory(): number;
}
/** Read at every decision: both change with cgroup limits and other work. */
export const hostProbe: HostProbe = {
  cores: () => availableParallelism(),
  memory: () =>
    typeof process.availableMemory === "function"
      ? process.availableMemory()
      : freemem(),
};

interface Waiter {
  cost: HostCost;
  start(): void;
}

export class HostCapacity {
  private readonly waiting: Waiter[] = [];
  private cores = 0;
  private running = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private readonly probe: HostProbe = hostProbe) {}

  /** Runs `work` once the machine has room for it. `queued` is told how many
   * steps are ahead when it has to wait. Aborting while waiting gives the
   * turn up; a step that started is never interrupted from here. */
  async run<T>(
    cost: HostCost,
    signal: AbortSignal,
    work: () => Promise<T>,
    queued?: (ahead: number) => void,
  ): Promise<T> {
    await this.admit(cost, signal, queued);
    try {
      return await work();
    } finally {
      this.cores -= cost.cores;
      this.running--;
      this.pump();
    }
  }

  private admit(
    cost: HostCost,
    signal: AbortSignal,
    queued?: (ahead: number) => void,
  ): Promise<void> {
    if (signal.aborted) throw new ContractError("stale");
    let waiter!: Waiter;
    const admitted = new Promise<void>((resolve, reject) => {
      const abort = () => {
        const at = this.waiting.indexOf(waiter);
        if (at < 0) return;
        this.waiting.splice(at, 1);
        reject(new ContractError("stale"));
        // The step behind it may be the one that fits.
        this.pump();
      };
      waiter = {
        cost,
        start: () => {
          signal.removeEventListener("abort", abort);
          resolve();
        },
      };
      this.waiting.push(waiter);
      signal.addEventListener("abort", abort, { once: true });
    });
    this.pump();
    const ahead = this.waiting.indexOf(waiter);
    if (ahead >= 0) queued?.(ahead);
    return admitted;
  }

  /** One step always runs, whatever the machine reports: a small host makes
   * work slow, never impossible. */
  private fits(cost: HostCost): boolean {
    return (
      this.running === 0 ||
      (this.cores + cost.cores <= this.probe.cores() &&
        this.probe.memory() >= cost.bytes + HOST_RESERVE_BYTES)
    );
  }

  private pump(): void {
    // Strictly in arrival order: a large step is never overtaken forever by
    // small ones that happen to fit.
    while (this.waiting.length && this.fits(this.waiting[0].cost)) {
      const waiter = this.waiting.shift() as Waiter;
      this.cores += waiter.cost.cores;
      this.running++;
      waiter.start();
    }
    if (this.waiting.length && !this.timer) {
      this.timer = setInterval(() => this.pump(), RECHECK_MS);
      this.timer.unref?.();
    } else if (!this.waiting.length && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
