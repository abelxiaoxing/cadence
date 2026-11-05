/** Checkout ordering/ownership unit controls; original process settlement is tested by service-owner/workflow. */
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  CHECKOUT_READERS,
  CHECKOUT_WAITERS,
  CheckoutGate,
} from "../src/service/checkout-gate.ts";
import type { OwnerPhase } from "../src/service/coordination.ts";

function fixture() {
  const owner = { state: "idle" as OwnerPhase, lease: { assert: vi.fn() } };
  return { owner, gate: new CheckoutGate(owner) };
}
const signal = () => new AbortController().signal;
it("FIFO grants one permit, including when the first acquire promise has not been awaited", async () => {
  const { gate } = fixture();
  const first = gate.acquire(randomUUID(), signal());
  let observed = false;
  const second = gate.acquire(randomUUID(), signal()).then((p) => {
    observed = true;
    return p;
  });
  await Promise.resolve();
  expect(observed).toBe(false);
  expect(() => gate.assertQuiescent()).toThrow("conflict");
  const a = await first;
  a.assertHeld();
  a.release();
  const b = await second;
  b.assertHeld();
  b.release();
  gate.assertQuiescent();
});
it("duplicate IDs refuse; an expired handle cannot release a new permit with the same ID", async () => {
  const { gate } = fixture(),
    id = randomUUID();
  const a = await gate.acquire(id, signal());
  expect(() => gate.acquire(id, signal())).toThrow("conflict");
  const queued = randomUUID(),
    b = gate.acquire(queued, signal());
  expect(() => gate.acquire(queued, signal())).toThrow("conflict");
  a.release();
  (await b).release();
  const next = await gate.acquire(id, signal());
  expect(() => a.release()).toThrow("stale");
  next.assertHeld();
  next.release();
});
it("aborting a queued request removes only it, without consuming its successor", async () => {
  const { gate } = fixture(),
    abort = new AbortController();
  const a = await gate.acquire(randomUUID(), signal());
  const rejected = expect(
    gate.acquire(randomUUID(), abort.signal),
  ).rejects.toThrow("stale");
  let acquired = false;
  const b = gate.acquire(randomUUID(), signal()).then((p) => {
    acquired = true;
    return p;
  });
  abort.abort();
  await rejected;
  expect(acquired).toBe(false);
  a.release();
  (await b).release();
  expect(() => gate.acquire(randomUUID(), abort.signal)).toThrow("stale");
  gate.assertQuiescent();
});
it("aborting a holder never releases its checkout; only original settlement may do that", async () => {
  const { gate } = fixture(),
    abort = new AbortController();
  const a = await gate.acquire(randomUUID(), abort.signal);
  let acquired = false;
  const b = gate.acquire(randomUUID(), signal()).then((p) => {
    acquired = true;
    return p;
  });
  abort.abort();
  await Promise.resolve();
  a.assertHeld();
  expect(acquired).toBe(false);
  a.release();
  (await b).release();
});
it("bounded waiter reservation is returned on queued cancellation, not on holder abort", async () => {
  const { gate } = fixture();
  const a = await gate.acquire(randomUUID(), signal());
  const controllers = Array.from(
    { length: CHECKOUT_WAITERS },
    () => new AbortController(),
  );
  const waits = controllers.map((c) =>
    expect(gate.acquire(randomUUID(), c.signal)).rejects.toThrow(),
  );
  expect(() => gate.acquire(randomUUID(), signal())).toThrow("capacity");
  controllers[0].abort();
  await waits[0];
  const replacement = expect(
    gate.acquire(randomUUID(), signal()),
  ).rejects.toThrow("quarantine");
  gate.closeAdmission();
  await Promise.all([...waits, replacement]);
  expect(() => a.release()).toThrow("quarantine");
});
it.each(["stopping", "quarantined", "stopped"] as const)(
  "%s does not authorize release, new admission or configuration replacement",
  async (phase) => {
    const { gate, owner } = fixture();
    const held = await gate.acquire(randomUUID(), signal());
    owner.state = phase;
    expect(() => held.release()).toThrow("quarantine");
    expect(() => gate.acquire(randomUUID(), signal())).toThrow("quarantine");
    expect(() => gate.assertQuiescent()).toThrow("quarantine");
  },
);
it("closing admission settles all waiting reports but never refunds the active permit", async () => {
  const { gate } = fixture();
  const held = await gate.acquire(randomUUID(), signal());
  const waits = [0, 1].map(() =>
    expect(gate.acquire(randomUUID(), signal())).rejects.toThrow("quarantine"),
  );
  gate.closeAdmission();
  gate.closeAdmission();
  await Promise.all(waits);
  expect(() => held.release()).toThrow("quarantine");
  expect(() => gate.assertQuiescent()).toThrow("quarantine");
});
it("shared readers overlap but never bypass an earlier writer", async () => {
  const { gate } = fixture();
  const a = await gate.acquire(randomUUID(), signal(), "shared");
  const b = await gate.acquire(randomUUID(), signal(), "shared");
  const order: string[] = [];
  const writer = gate.acquire(randomUUID(), signal()).then((p) => {
    order.push("writer");
    return p;
  });
  const reader = gate.acquire(randomUUID(), signal(), "shared").then((p) => {
    order.push("reader");
    return p;
  });
  a.release();
  await Promise.resolve();
  expect(order).toEqual([]);
  b.release();
  const exclusive = await writer;
  expect(order).toEqual(["writer"]);
  exclusive.release();
  (await reader).release();
  expect(order).toEqual(["writer", "reader"]);
  gate.assertQuiescent();
});
it("canceling a queued writer unblocks compatible readers, never refunds a shared holder", async () => {
  const { gate } = fixture();
  const first = new AbortController();
  const a = await gate.acquire(randomUUID(), first.signal, "shared");
  const abort = new AbortController();
  const writer = expect(
    gate.acquire(randomUUID(), abort.signal),
  ).rejects.toThrow("stale");
  const reader = gate.acquire(randomUUID(), signal(), "shared");
  abort.abort();
  await writer;
  const b = await reader;
  first.abort();
  a.assertHeld();
  b.release();
  expect(() => gate.assertQuiescent()).toThrow("conflict");
  a.release();
  gate.assertQuiescent();
});
it("bounds shared holders and retains every permit on quarantine", async () => {
  const { gate, owner } = fixture();
  const readers = await Promise.all(
    Array.from({ length: CHECKOUT_READERS }, () =>
      gate.acquire(randomUUID(), signal(), "shared"),
    ),
  );
  let entered = false;
  const next = gate.acquire(randomUUID(), signal(), "shared").then((p) => {
    entered = true;
    return p;
  });
  await Promise.resolve();
  expect(entered).toBe(false);
  readers.shift()?.release();
  readers.push(await next);
  owner.state = "quarantined";
  for (const p of readers) expect(() => p.release()).toThrow("quarantine");
  owner.state = "idle";
  expect(() => gate.assertQuiescent()).toThrow("conflict");
  for (const p of readers) p.release();
  gate.assertQuiescent();
});
it("lost lease is rechecked at both observation and release, never treated as settlement", async () => {
  const { gate, owner } = fixture();
  const held = await gate.acquire(randomUUID(), signal());
  owner.lease.assert.mockImplementation(() => {
    throw Error("changed lease");
  });
  expect(() => held.assertHeld()).toThrow("changed lease");
  expect(() => held.release()).toThrow("changed lease");
  expect(() => gate.acquire(randomUUID(), signal())).toThrow("changed lease");
});
