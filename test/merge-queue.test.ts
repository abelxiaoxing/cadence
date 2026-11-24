/** Landing order per target branch: pure ordering, no Git. */
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { LandingLog, laneKey, MergeQueue } from "../src/service/merge-queue.ts";

const MAIN = laneKey("repo", "refs/heads/main");
const never = () => new AbortController().signal;
const settle = () => new Promise((resolve) => setImmediate(resolve));

it("one entry per branch holds the turn; the rest follow in arrival order", async () => {
  const queue = new MergeQueue();
  const tickets = [queue.ticket(), queue.ticket(), queue.ticket()];
  const order: number[] = [];
  // Entered out of arrival order on purpose.
  const first = await queue.enter(MAIN, randomUUID(), tickets[1], never());
  const turns = [tickets[2], tickets[0]].map((ticket) =>
    queue.enter(MAIN, randomUUID(), ticket, never()).then((turn) => {
      order.push(ticket);
      return turn;
    }),
  );
  await settle();
  expect(order).toEqual([]);
  expect(first.waiting()).toBe(2);
  first.release();
  await settle();
  expect(order).toEqual([tickets[0]]);
  (await turns[1]).release();
  await settle();
  expect(order).toEqual([tickets[0], tickets[2]]);
  (await turns[0]).release();
  expect(queue.busy).toBe(false);
});
it("a run that steps aside comes back first with its own ticket", async () => {
  const queue = new MergeQueue();
  const early = queue.ticket(),
    late = queue.ticket(),
    later = queue.ticket();
  const id = randomUUID();
  // The early run takes its turn, steps aside to repair, and meanwhile the
  // late one lands.
  (await queue.enter(MAIN, id, early, never())).release();
  const landing = await queue.enter(MAIN, randomUUID(), late, never());
  const order: string[] = [];
  const third = queue.enter(MAIN, randomUUID(), later, never()).then((turn) => {
    order.push("later");
    return turn;
  });
  const back = queue.enter(MAIN, id, early, never()).then((turn) => {
    order.push("early");
    return turn;
  });
  expect(queue.ahead(MAIN, early)).toBe(1);
  expect(queue.ahead(MAIN, later)).toBe(2);
  landing.release();
  await settle();
  expect(order).toEqual(["early"]);
  (await back).release();
  (await third).release();
  expect(order).toEqual(["early", "later"]);
});
it("branches never wait on one another", async () => {
  const queue = new MergeQueue();
  const release = laneKey("repo", "refs/heads/release");
  const a = await queue.enter(MAIN, randomUUID(), queue.ticket(), never());
  const b = await queue.enter(release, randomUUID(), queue.ticket(), never());
  expect(queue.ahead(MAIN, queue.ticket())).toBe(1);
  expect(laneKey("other-repo", "refs/heads/main")).not.toBe(MAIN);
  a.release();
  expect(queue.busy).toBe(true);
  b.release();
  expect(queue.busy).toBe(false);
});
it("canceling a waiter removes only it; canceling the holder releases nothing", async () => {
  const queue = new MergeQueue();
  const holding = new AbortController();
  const held = await queue.enter(
    MAIN,
    randomUUID(),
    queue.ticket(),
    holding.signal,
  );
  const waiting = new AbortController();
  const gone = expect(
    queue.enter(MAIN, randomUUID(), queue.ticket(), waiting.signal),
  ).rejects.toThrow("stale");
  let entered = false;
  const next = queue
    .enter(MAIN, randomUUID(), queue.ticket(), never())
    .then((turn) => {
      entered = true;
      return turn;
    });
  waiting.abort();
  await gone;
  holding.abort();
  await settle();
  expect(entered).toBe(false);
  held.release();
  (await next).release();
  expect(() => held.release()).toThrow("stale");
  expect(() =>
    queue.enter(MAIN, randomUUID(), queue.ticket(), waiting.signal),
  ).toThrow("stale");
});
it("refuses a second entry of the same run or ticket, and a ticket it never issued", async () => {
  const queue = new MergeQueue();
  const id = randomUUID(),
    ticket = queue.ticket();
  const turn = await queue.enter(MAIN, id, ticket, never());
  expect(() => queue.enter(MAIN, id, queue.ticket(), never())).toThrow(
    "conflict",
  );
  expect(() => queue.enter(MAIN, randomUUID(), ticket, never())).toThrow(
    "conflict",
  );
  expect(() => queue.enter(MAIN, randomUUID(), 999, never())).toThrow(
    "invalid",
  );
  turn.release();
});
it("waiters are not counted", async () => {
  const queue = new MergeQueue();
  const first = await queue.enter(MAIN, randomUUID(), queue.ticket(), never());
  const order: number[] = [];
  const all = Array.from({ length: 500 }, (_, i) =>
    queue.enter(MAIN, randomUUID(), queue.ticket(), never()).then((turn) => {
      order.push(i);
      turn.release();
    }),
  );
  first.release();
  await Promise.all(all);
  expect(order).toEqual(Array.from({ length: 500 }, (_, i) => i));
});

it("the landing log answers what landed after a run took its baseline, per branch, and drops what nobody can ask for", () => {
  const log = new LandingLog<string>();
  const OTHER = laneKey("repo", "refs/heads/release");
  expect(log.mark(MAIN)).toBe(0);
  expect(log.since(MAIN, 0)).toEqual([]);
  log.add(MAIN, "first");
  // A run admitted now has the first landing in its baseline already.
  const mark = log.mark(MAIN);
  log.add(MAIN, "second");
  log.add(OTHER, "elsewhere");
  log.add(MAIN, "third");
  expect(log.since(MAIN, mark)).toEqual(["second", "third"]);
  expect(log.since(MAIN, 0)).toEqual(["first", "second", "third"]);
  expect(log.since(OTHER, 0)).toEqual(["elsewhere"]);
  // The oldest run still working started at `mark`: what came before goes.
  log.retain(MAIN, mark);
  expect(log.since(MAIN, 0)).toEqual(["second", "third"]);
  expect(log.since(MAIN, mark)).toEqual(["second", "third"]);
  // Marks keep counting from where they were.
  expect(log.mark(MAIN)).toBe(3);
  // Nobody is working on the branch any more: nothing is kept.
  log.retain(MAIN, null);
  expect(log.since(MAIN, 0)).toEqual([]);
  expect(log.mark(MAIN)).toBe(0);
  expect(log.since(OTHER, 0)).toEqual(["elsewhere"]);
  log.retain(laneKey("repo", "refs/heads/unknown"), null);
});
