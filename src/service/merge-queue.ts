/** Landing order for deliveries that share one target branch. Arrival order is
 * a ticket a run takes once; a run that steps aside (to repair in isolation,
 * or because the branch cannot take a landing just now) comes back with the
 * same ticket, so it is first again and nothing that arrived later can starve
 * it. One entry per lane holds the turn; lanes never wait on one another. A
 * waiter leaves only through its own abort signal, which the owner raises for
 * every run it stops.
 *
 * A waiter may offer to be landed by whoever holds the turn. The holder sees
 * those offers in arrival order, holds the ones it is about to land (from
 * then on a cancellation cannot take them out from under it) and ends their
 * wait with what it did for them. Whom it does not land waits on as before.
 * The queue runs no Git, no worker and no timer. */
import { ContractError } from "./contracts/core.ts";

export interface QueueTurn<O = unknown, R = unknown> {
  /** Entries waiting behind this one on the same lane. */
  waiting(): number;
  /** Ends this turn; the lowest waiting ticket is next. Whoever is still
   * held is let go first. */
  release(): void;
  /** Those waiting behind this turn that offered to be landed with it, in
   * arrival order. */
  offers(): { id: string; offer: O }[];
  /** Holds the named waiters: none of them leaves the queue through its
   * abort signal until it is settled or let go. False, with nobody held,
   * when one of them is no longer waiting with an offer. */
  hold(ids: readonly string[]): boolean;
  /** Ends the wait of every held entry that has a result here, with it. */
  settle(results: ReadonlyMap<string, R>): void;
  /** Held entries wait for their own turn again; one whose signal fired
   * meanwhile leaves now. */
  letGo(): void;
}
/** How a wait ended: with the turn, or landed by the holder of one. */
export type Entered<O, R> = { turn: QueueTurn<O, R> } | { carried: R };
interface Entry<O, R> {
  id: string;
  ticket: number;
  offer: { value: O } | null;
  held: boolean;
  /** Its signal fired while it was held. */
  aborted: boolean;
  end(entered: Entered<O, R>): void;
  leave(): void;
}
interface Lane<O, R> {
  holder: Entry<O, R> | null;
  waiting: Entry<O, R>[];
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

export class MergeQueue<O = never, R = never> {
  private issued = 0;
  private readonly lanes = new Map<string, Lane<O, R>>();

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

  /** Waits for the turn. An entry that cannot be made is refused at once. */
  enter(
    key: string,
    id: string,
    ticket: number,
    signal: AbortSignal,
  ): Promise<QueueTurn<O, R>> {
    return this.wait(key, id, ticket, signal, null).then((entered) => {
      // Nobody is landed by another without having offered it.
      if (!("turn" in entered)) throw new ContractError("invalid");
      return entered.turn;
    });
  }
  /** Waits for the turn, offering to be landed by an earlier holder instead. */
  join(
    key: string,
    id: string,
    ticket: number,
    signal: AbortSignal,
    offer: O,
  ): Promise<Entered<O, R>> {
    return this.wait(key, id, ticket, signal, { value: offer });
  }
  private wait(
    key: string,
    id: string,
    ticket: number,
    signal: AbortSignal,
    offer: { value: O } | null,
  ): Promise<Entered<O, R>> {
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
    const entered = new Promise<Entered<O, R>>((resolve, reject) => {
      const abort = () => {
        // Held: whoever holds it decides what becomes of it.
        if (entry.held) entry.aborted = true;
        else entry.leave();
      };
      const entry: Entry<O, R> = {
        id,
        ticket,
        offer,
        held: false,
        aborted: false,
        end: (result) => {
          signal.removeEventListener("abort", abort);
          resolve(result);
        },
        leave: () => {
          const at = active.waiting.indexOf(entry);
          if (at < 0) return;
          active.waiting.splice(at, 1);
          signal.removeEventListener("abort", abort);
          reject(new ContractError("stale"));
          this.pump(key, active);
        },
      };
      const at = active.waiting.findIndex((other) => other.ticket > ticket);
      active.waiting.splice(at < 0 ? active.waiting.length : at, 0, entry);
      signal.addEventListener("abort", abort, { once: true });
    });
    this.pump(key, active);
    return entered;
  }

  private pump(key: string, lane: Lane<O, R>): void {
    if (!lane.holder && lane.waiting.length) {
      const entry = lane.waiting.shift() as Entry<O, R>;
      lane.holder = entry;
      // Object identity: an old turn cannot act for a later one.
      const mine = () => {
        if (lane.holder !== entry) throw new ContractError("stale");
      };
      const held = () => lane.waiting.filter((other) => other.held);
      const letGo = () => {
        for (const other of held()) {
          other.held = false;
          if (other.aborted) other.leave();
        }
      };
      entry.end({
        turn: {
          waiting: () => lane.waiting.length,
          offers: () =>
            lane.waiting.flatMap((other) =>
              other.offer && !other.held
                ? [{ id: other.id, offer: other.offer.value }]
                : [],
            ),
          hold: (ids) => {
            mine();
            const named = ids.map((id) =>
              lane.waiting.find(
                (other) => other.id === id && other.offer && !other.held,
              ),
            );
            if (named.some((other) => !other)) return false;
            for (const other of named) if (other) other.held = true;
            return true;
          },
          settle: (results) => {
            mine();
            for (const other of held()) {
              if (!results.has(other.id)) continue;
              lane.waiting.splice(lane.waiting.indexOf(other), 1);
              other.end({ carried: results.get(other.id) as R });
            }
          },
          letGo: () => {
            mine();
            letGo();
          },
          release: () => {
            mine();
            letGo();
            lane.holder = null;
            this.pump(key, lane);
          },
        },
      });
    }
    if (!lane.holder && !lane.waiting.length && this.lanes.get(key) === lane)
      this.lanes.delete(key);
  }
}
