/** Explicit port/handle injections. These do NOT qualify native shell or disk. */
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  CHECK_RAW_BYTES,
  CheckRecording,
} from "../src/service/check-recording.ts";
import { CaptureBudgetPool } from "../src/service/contracts/budget.ts";
import type {
  OwnerJournalPort,
  OwnerReservation,
} from "../src/service/ports.ts";
import {
  ContractError,
  type OwnerRecordingInput,
} from "../src/service-contract.ts";

it("raw over-limit is refused before copies/queue; existing aggregate service allowance is16MiB", async () => {
  const pool = new CaptureBudgetPool();
  const port: OwnerJournalPort = {
    reserve: (budget) => {
      const lease = pool.reserve(budget);
      return {
        status: "reserved",
        reservation: {
          grow: () => ({
            status: "refused",
            error: { code: "capacity", effect: "none", recovery: "operator" },
          }),
          release: () => lease.release(),
          commit: async () => {
            throw new Error("no writer effect allowed");
          },
        },
      };
    },
  };
  const recorder = new CheckRecording(
    port,
    {
      epoch: randomUUID(),
      operationId: randomUUID(),
      taskId: randomUUID(),
      runId: randomUUID(),
    },
    randomUUID(),
    ["fake-private"],
  );
  const initial = pool.accounting;
  expect(CHECK_RAW_BYTES).toBe(16 * 1024 * 1024);
  await expect(
    recorder.receive(Buffer.alloc(65537), "stdout"),
  ).rejects.toBeInstanceOf(ContractError);
  expect(pool.accounting).toEqual(initial);
  await recorder.end(false);
  expect(recorder.result()).toMatchObject({
    output: null,
    coverage: { observed: "incomplete" },
  });
  expect(pool.accounting.leases).toBe(0);
});

it("real original receive continuations retain independently charged raw queues through a slow/refusing injected sink", async () => {
  const pool = new CaptureBudgetPool();
  let release!: () => void;
  const held = new Promise<void>((yes) => {
    release = yes;
  });
  let commits = 0;
  const port: OwnerJournalPort = {
    reserve: (budget) => {
      const lease = pool.reserve(budget);
      const reservation: OwnerReservation = {
        grow: () => ({ status: "reserved" }),
        release: () => lease.release(),
        commit: async (input: OwnerRecordingInput) => {
          // Deliberately refused port: never return a fabricated committed reference.
          lease.beginOwner(input);
          commits++;
          await held;
          lease.settled();
          return {
            status: "refused",
            durability: "none",
            error: {
              code: "recording-exhausted",
              effect: "none",
              recovery: "operator",
            },
          };
        },
      };
      return { status: "reserved", reservation };
    },
  };
  const recorder = new CheckRecording(
    port,
    {
      epoch: randomUUID(),
      operationId: randomUUID(),
      taskId: randomUUID(),
      runId: randomUUID(),
    },
    randomUUID(),
    ["split-literal"],
  );
  const a = recorder.receive(Buffer.from("a".repeat(1024)), "stdout"),
    b = recorder.receive(Buffer.from("b".repeat(1024)), "stderr"),
    c = recorder.receive(Buffer.from("c".repeat(1024)), "stdout");
  const results = Promise.allSettled([a, b, c]);
  await new Promise((yes) => setImmediate(yes));
  expect(commits).toBe(2); // one active per stream; third already charged, not copied/processed
  expect(pool.accounting.leases).toBeGreaterThan(4);
  release();
  expect((await results).every((r) => r.status === "rejected")).toBe(true);
  await recorder.end(false);
  expect(pool.accounting.leases).toBe(0);
});

it("additive literal updates retain both pending prefixes and old secrets within the unchanged aggregate bound", async () => {
  const { TextSanitizer } = await import("../src/worker-redaction.mjs");
  const s = new TextSanitizer(["older-private-literal"]);
  let text = s.write("older-private-");
  s.addSecrets(["rotated-private-literal"]);
  text += s.write("literal rotated-private-");
  s.addSecrets(["newest-private-literal"]);
  text += s.write("literal older-private-literal newest-private-literal", true);
  expect(text).toBe("[redacted] [redacted] [redacted] [redacted]");
  const bounded = new TextSanitizer(["a".repeat(128 * 1024)]);
  bounded.addSecrets(["b".repeat(128 * 1024)]);
  expect(() => bounded.addSecrets(["new"])).toThrow(ContractError);
  // A failed union update cannot evict already-known literals.
  expect(bounded.write("b".repeat(128 * 1024), true)).toBe("[redacted]");
});

it("service raw aggregate is inclusive16MiB, over-limit and failed literal refresh remain non-success with no fabricated sink", async () => {
  const pool = new CaptureBudgetPool();
  let changed: (() => void) | undefined,
    unsubscribed = false;
  const port: OwnerJournalPort = {
    reserve: (budget) => {
      const lease = pool.reserve(budget);
      return {
        status: "reserved",
        reservation: {
          grow: () => ({ status: "reserved" }),
          release: () => lease.release(),
          commit: async () => {
            throw Error("no content commit expected for stripped controls");
          },
        },
      };
    },
  };
  let uncertain = false;
  const recorder = new CheckRecording(
    port,
    {
      epoch: randomUUID(),
      operationId: randomUUID(),
      taskId: randomUUID(),
      runId: randomUUID(),
    },
    randomUUID(),
    [],
    {
      current: () => {
        if (uncertain) throw new ContractError("stale");
        return [];
      },
      onChange: (listener) => {
        changed = listener;
        return () => {
          unsubscribed = true;
        };
      },
    },
  );
  // This fixture deliberately does not begin/end a successful content record.
  // Stripped controls produce no writes, so no invented content reference exists.
  for (let n = 0; n < CHECK_RAW_BYTES / 65536; n++)
    await recorder.receive(Buffer.alloc(65536), "stdout");
  await expect(recorder.receive(Buffer.alloc(1), "stderr")).rejects.toThrow(
    ContractError,
  );
  await recorder.end(false);
  expect(unsubscribed).toBe(true);
  expect(pool.accounting.leases).toBe(0);
  expect(recorder.result()).toMatchObject({
    output: null,
    coverage: { observed: "incomplete" },
  });
  unsubscribed = false;
  const changedSource = new CheckRecording(
    port,
    {
      epoch: randomUUID(),
      operationId: randomUUID(),
      taskId: randomUUID(),
      runId: randomUUID(),
    },
    randomUUID(),
    [],
    {
      current: () => {
        if (uncertain) throw new ContractError("stale");
        return [];
      },
      onChange: (listener) => {
        changed = listener;
        return () => {
          unsubscribed = true;
        };
      },
    },
  );
  uncertain = true;
  changed!();
  await expect(
    changedSource.receive(Buffer.from("must not persist"), "stdout"),
  ).rejects.toThrow(ContractError);
  await changedSource.end(false);
  expect(unsubscribed).toBe(true);
  expect(pool.accounting.leases).toBe(0);
  expect(changedSource.result().coverage.observed).toBe("incomplete");
});
