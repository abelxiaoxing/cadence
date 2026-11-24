/** Checkout ordering/ownership unit controls; original process settlement is tested by service-owner/workflow. */
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { CheckoutGate } from "../src/service/checkout-gate.ts";
import type { OwnerPhase } from "../src/service/coordination.ts";

const ROOT = "/checkout";
function fixture() {
  const owner = { state: "idle" as OwnerPhase, lease: { assert: vi.fn() } };
  const gate = new CheckoutGate(owner);
  return {
    owner,
    gate,
    acquire: (signal = new AbortController().signal, at = ROOT) =>
      gate.acquire(at, randomUUID(), signal),
  };
}
it("FIFO grants one permit, including when the first acquire promise has not been awaited", async () => {
  const { gate, acquire } = fixture();
  const first = acquire();
  let observed = false;
  const second = acquire().then((p) => {
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
    id = randomUUID(),
    signal = () => new AbortController().signal;
  const a = await gate.acquire(ROOT, id, signal());
  expect(() => gate.acquire(ROOT, id, signal())).toThrow("conflict");
  const queued = randomUUID(),
    b = gate.acquire(ROOT, queued, signal());
  expect(() => gate.acquire(ROOT, queued, signal())).toThrow("conflict");
  a.release();
  (await b).release();
  const next = await gate.acquire(ROOT, id, signal());
  expect(() => a.release()).toThrow("stale");
  next.assertHeld();
  next.release();
});
it("aborting a queued request removes only it, without consuming its successor", async () => {
  const { gate, acquire } = fixture(),
    abort = new AbortController();
  const a = await acquire();
  const rejected = expect(acquire(abort.signal)).rejects.toThrow("stale");
  let acquired = false;
  const b = acquire().then((p) => {
    acquired = true;
    return p;
  });
  abort.abort();
  await rejected;
  expect(acquired).toBe(false);
  a.release();
  (await b).release();
  expect(() => acquire(abort.signal)).toThrow("stale");
  gate.assertQuiescent();
});
it("aborting a holder never releases its checkout; only original settlement may do that", async () => {
  const { acquire } = fixture(),
    abort = new AbortController();
  const a = await acquire(abort.signal);
  let acquired = false;
  const b = acquire().then((p) => {
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
it("waiters are not counted: every one is served in arrival order", async () => {
  const { gate, acquire } = fixture();
  const first = await acquire();
  const order: number[] = [];
  const waits = Array.from({ length: 200 }, (_, i) =>
    acquire().then((permit) => {
      order.push(i);
      permit.release();
    }),
  );
  first.release();
  await Promise.all(waits);
  expect(order).toEqual(Array.from({ length: 200 }, (_, i) => i));
  gate.assertQuiescent();
});
it("different checkouts never wait on one another", async () => {
  const { gate, acquire } = fixture();
  const a = await acquire(undefined, "/checkout");
  const b = await acquire(undefined, "/other-worktree");
  a.assertHeld();
  b.assertHeld();
  expect(() => gate.assertQuiescent()).toThrow("conflict");
  a.release();
  expect(() => gate.assertQuiescent()).toThrow("conflict");
  b.release();
  gate.assertQuiescent();
});
it.each(["stopping", "quarantined", "stopped"] as const)(
  "%s does not authorize release, new admission or configuration replacement",
  async (phase) => {
    const { gate, owner, acquire } = fixture();
    const held = await acquire();
    owner.state = phase;
    expect(() => held.release()).toThrow("quarantine");
    expect(() => acquire()).toThrow("quarantine");
    expect(() => gate.assertQuiescent()).toThrow("quarantine");
  },
);
it("closing admission settles all waiting reports but never refunds the active permit", async () => {
  const { gate, acquire } = fixture();
  const held = await acquire();
  const waits = [0, 1].map(() =>
    expect(acquire()).rejects.toThrow("quarantine"),
  );
  gate.closeAdmission();
  gate.closeAdmission();
  await Promise.all(waits);
  expect(() => held.release()).toThrow("quarantine");
  expect(() => gate.assertQuiescent()).toThrow("quarantine");
});
it("a holder that survives quarantine keeps its checkout until it settles", async () => {
  const { gate, owner, acquire } = fixture();
  const held = await acquire();
  owner.state = "quarantined";
  expect(() => held.release()).toThrow("quarantine");
  owner.state = "idle";
  expect(() => gate.assertQuiescent()).toThrow("conflict");
  held.release();
  gate.assertQuiescent();
});
it("lost lease is rechecked at both observation and release, never treated as settlement", async () => {
  const { owner, acquire } = fixture();
  const held = await acquire();
  owner.lease.assert.mockImplementation(() => {
    throw Error("changed lease");
  });
  expect(() => held.assertHeld()).toThrow("changed lease");
  expect(() => held.release()).toThrow("changed lease");
  expect(() => acquire()).toThrow("changed lease");
});
