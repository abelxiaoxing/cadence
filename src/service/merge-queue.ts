/** Landing order for deliveries that share one target branch. Arrival order is
 * a ticket a run takes once; a run that steps aside (to repair in isolation,
 * or because the branch cannot take a landing just now) comes back with the
 * same ticket, so it is first again and nothing that arrived later can starve
 * it. One entry per lane holds the turn; lanes never wait on one another. A
 * waiter leaves only through its own abort signal, which the owner raises for
 * every run it stops. It runs no Git, no worker and no timer. */
import { ContractError } from "./contracts/core.ts";

export interface QueueTurn {
  /** Entries waiting behind this one on the same lane. */
  waiting(): number;
  /** Ends this turn; the lowest waiting ticket is next. */
  release(): void;
}
interface Entry {
  id: string;
  ticket: number;
  grant(turn: QueueTurn): void;
}
interface Lane {
  holder: Entry | null;
  waiting: Entry[];
}

/** One lane per repository and target branch. */
export function laneKey(repositoryIdentity: string, branch: string): string {
  return `${repositoryIdentity}\0${branch}`;
}

/** What landed on each lane while this owner ran, in landing order. A run
 * takes the lane's mark together with its baseline; whatever was added after
 * that mark landed while it worked. Entries no run can ask for any more are
 * dropped. In memory only: nothing interrupted is continued after a restart,
 * so nothing would ask. */
export class LandingLog<T> {
  private readonly lanes = new Map<
    string,
    { added: number; entries: { at: number; value: T }[] }
  >();

  /** How many landings this lane has seen so far. */
  mark(key: string): number {
    return this.lanes.get(key)?.added ?? 0;
  }
  add(key: string, value: T): void {
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = { added: 0, entries: [] };
      this.lanes.set(key, lane);
    }
    lane.entries.push({ at: ++lane.added, value });
  }
  /** What landed after `mark`, oldest first. */
  since(key: string, mark: number): T[] {
    return (this.lanes.get(key)?.entries ?? [])
      .filter((entry) => entry.at > mark)
      .map((entry) => entry.value);
  }
  /** Drops what no run asks for: `oldest` is the lowest mark a run on this
   * lane still holds, null when none holds one. */
  retain(key: string, oldest: number | null): void {
    const lane = this.lanes.get(key);
    if (!lane) return;
    if (oldest === null) this.lanes.delete(key);
    else lane.entries = lane.entries.filter((entry) => entry.at > oldest);
  }
}

export class MergeQueue {
  private issued = 0;
  private readonly lanes = new Map<string, Lane>();

  /** A run's place in arrival order, kept across every re-entry. */
  ticket(): number {
    return ++this.issued;
  }
  /** Entries on this lane that are served before `ticket`. */
  ahead(key: string, ticket: number): number {
    const lane = this.lanes.get(key);
    if (!lane) return 0;
    return (
      (lane.holder && lane.holder.ticket !== ticket ? 1 : 0) +
      lane.waiting.filter((entry) => entry.ticket < ticket).length
    );
  }
  /** Whether any lane has a holder or a waiter. */
  get busy(): boolean {
    return this.lanes.size > 0;
  }

  enter(
    key: string,
    id: string,
    ticket: number,
    signal: AbortSignal,
  ): Promise<QueueTurn> {
    if (signal.aborted) throw new ContractError("stale");
    if (!Number.isSafeInteger(ticket) || ticket < 1 || ticket > this.issued)
      throw new ContractError("invalid");
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = { holder: null, waiting: [] };
      this.lanes.set(key, lane);
    }
    const active = lane;
    if (
      [active.holder, ...active.waiting].some(
        (entry) => entry?.id === id || entry?.ticket === ticket,
      )
    )
      throw new ContractError("conflict");
    const turn = new Promise<QueueTurn>((resolve, reject) => {
      const abort = () => {
        const at = active.waiting.indexOf(entry);
        if (at < 0) return;
        active.waiting.splice(at, 1);
        reject(new ContractError("stale"));
        this.pump(key, active);
      };
      const entry: Entry = {
        id,
        ticket,
        grant: (granted) => {
          signal.removeEventListener("abort", abort);
          resolve(granted);
        },
      };
      const at = active.waiting.findIndex((other) => other.ticket > ticket);
      active.waiting.splice(at < 0 ? active.waiting.length : at, 0, entry);
      signal.addEventListener("abort", abort, { once: true });
    });
    this.pump(key, active);
    return turn;
  }

  private pump(key: string, lane: Lane): void {
    if (!lane.holder && lane.waiting.length) {
      const entry = lane.waiting.shift() as Entry;
      lane.holder = entry;
      entry.grant({
        waiting: () => lane.waiting.length,
        release: () => {
          // Object identity: an old turn cannot release a later one.
          if (lane.holder !== entry) throw new ContractError("stale");
          lane.holder = null;
          this.pump(key, lane);
        },
      });
    }
    if (!lane.holder && !lane.waiting.length && this.lanes.get(key) === lane)
      this.lanes.delete(key);
  }
}
