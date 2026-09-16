import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ArtifactStore } from "../src/artifact-store.ts";
import { WorkspaceStore } from "../src/workspace-store.ts";

const RED_IDENTITY = "[CADENCE-V2:T4-transactional-apply]";
const roots: string[] = [];
type ModuleRecord = Record<string, unknown>;

interface VerificationSuccess {
  ok: true;
  fact: unknown;
}

interface ApplyTransactionApi {
  new (
    options: Record<string, unknown>,
  ): {
    prepare(input: Record<string, unknown>): Promise<Record<string, unknown>>;
    apply(id: string): Promise<Record<string, unknown>>;
    recover(id: string): Promise<Record<string, unknown>>;
    requestControl(
      id: string,
      intent: "cancel" | "discard",
    ): Record<string, unknown>;
    status(id: string): Record<string, unknown>;
  };
}

let transactionModule: ModuleRecord | null = null;

beforeAll(async () => {
  try {
    transactionModule = (await import(
      "../src/apply-transaction.ts"
    )) as ModuleRecord;
  } catch {
    transactionModule = null;
  }
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function temporaryRoot(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `cadence-apply-${label}-`));
  roots.push(root);
  return root;
}

function requiredExport<T>(name: string, type: "function" = "function"): T {
  expect(
    transactionModule,
    `${RED_IDENTITY}: apply transaction module must exist`,
  ).not.toBeNull();
  expect(
    transactionModule?.[name],
    `${RED_IDENTITY}: ${name} must be exported`,
  ).toBeTypeOf(type);
  return transactionModule?.[name] as T;
}

function fixture(label: string) {
  const consumerRoot = temporaryRoot(`consumer-${label}`);
  execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
  writeFileSync(path.join(consumerRoot, "a.txt"), "a0\n");
  writeFileSync(path.join(consumerRoot, "b.txt"), "b0\n");
  execFileSync("git", ["add", "a.txt", "b.txt"], { cwd: consumerRoot });
  const privateRoot = temporaryRoot(`private-${label}`);
  const artifacts = new ArtifactStore(path.join(privateRoot, "artifacts"));
  const workspaces = new WorkspaceStore(
    path.join(privateRoot, "workspaces"),
    artifacts,
  );
  const baseline = workspaces.captureBaseline({ consumerRoot });
  const finalRevision = workspaces.createRevision({
    parentRevisionId: baseline.revisionId,
    changes: {
      "a.txt": Buffer.from("a1\n"),
      "b.txt": Buffer.from("b1\n"),
    },
  });
  return {
    consumerRoot,
    privateRoot,
    artifacts,
    workspaces,
    baseline,
    finalRevision,
  };
}

async function verified(fixtureValue: ReturnType<typeof fixture>) {
  const verifyCumulativeRevision = requiredExport<
    (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  >("verifyCumulativeRevision");
  const result = await verifyCumulativeRevision({
    workspaceStore: fixtureValue.workspaces,
    revisionId: fixtureValue.finalRevision.revisionId,
    verificationId: "change-suite",
    execute: async ({ root }: { root: string }) => {
      expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("a1\n");
      expect(readFileSync(path.join(root, "b.txt"), "utf8")).toBe("b1\n");
      return {
        ok: true,
        exitCode: 0,
        classification: "expected-green",
      };
    },
  });
  expect(result).toMatchObject({ ok: true });
  return (result as unknown as VerificationSuccess).fact;
}

async function verifiedRevision(
  fixtureValue: ReturnType<typeof fixture>,
  revisionId: string,
) {
  const verifyCumulativeRevision = requiredExport<
    (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  >("verifyCumulativeRevision");
  const result = await verifyCumulativeRevision({
    workspaceStore: fixtureValue.workspaces,
    revisionId,
    verificationId: "change-suite",
    execute: async () => ({
      ok: true,
      exitCode: 0,
      classification: "expected-green",
    }),
  });
  expect(result).toMatchObject({ ok: true });
  return (result as unknown as VerificationSuccess).fact;
}

function transaction(
  fixtureValue: ReturnType<typeof fixture>,
  hooks?: Record<string, unknown>,
) {
  const ApplyTransaction =
    requiredExport<ApplyTransactionApi>("ApplyTransaction");
  return new ApplyTransaction({
    root: path.join(fixtureValue.privateRoot, "transactions"),
    artifacts: fixtureValue.artifacts,
    workspaces: fixtureValue.workspaces,
    hooks,
  });
}

async function prepare(
  instance: ReturnType<typeof transaction>,
  fixtureValue: ReturnType<typeof fixture>,
  transactionId: string,
) {
  return instance.prepare({
    transactionId,
    consumerRoot: fixtureValue.consumerRoot,
    baselineRevisionId: fixtureValue.baseline.revisionId,
    finalRevisionId: fixtureValue.finalRevision.revisionId,
    boundPaths: ["a.txt", "b.txt"],
    verificationFact: await verified(fixtureValue),
  });
}

describe("recoverable cumulative apply", () => {
  it("persists intent before mutation, records steps, and recovers idempotently", async () => {
    const value = fixture("recovery");
    let crashed = false;
    const first = transaction(value, {
      afterFileMutation: () => {
        if (!crashed) {
          crashed = true;
          throw new Error("simulated-process-stop");
        }
      },
    });
    await prepare(first, value, "tx-recovery");
    await expect(first.apply("tx-recovery")).rejects.toThrow(
      "simulated-process-stop",
    );
    expect(first.status("tx-recovery")).toMatchObject({
      state: "recovering",
      rollbackRetained: true,
      events: [{ kind: "intent-prepared" }],
    });

    const restarted = transaction(value);
    await expect(restarted.recover("tx-recovery")).resolves.toMatchObject({
      ok: true,
      state: "completed",
    });
    await expect(restarted.recover("tx-recovery")).resolves.toMatchObject({
      ok: true,
      state: "completed",
      replayed: true,
    });
    expect(readFileSync(path.join(value.consumerRoot, "a.txt"), "utf8")).toBe(
      "a1\n",
    );
    expect(readFileSync(path.join(value.consumerRoot, "b.txt"), "utf8")).toBe(
      "b1\n",
    );
    expect(restarted.status("tx-recovery")).toMatchObject({
      state: "completed",
      rollbackRetained: false,
      steps: [
        { path: "a.txt", state: "applied" },
        { path: "b.txt", state: "applied" },
      ],
    });
  });

  it("uses per-file CAS, rolls back its own bytes, and preserves an external edit", async () => {
    const value = fixture("external-edit");
    let edited = false;
    const instance = transaction(value, {
      afterFileMutation: ({ path: changed }: { path: string }) => {
        if (changed === "a.txt" && !edited) {
          edited = true;
          writeFileSync(path.join(value.consumerRoot, "b.txt"), "external\n");
        }
      },
    });
    await prepare(instance, value, "tx-external");
    await expect(instance.apply("tx-external")).resolves.toMatchObject({
      ok: false,
      state: "paused",
      code: "recovery-required",
    });
    expect(readFileSync(path.join(value.consumerRoot, "a.txt"), "utf8")).toBe(
      "a0\n",
    );
    expect(readFileSync(path.join(value.consumerRoot, "b.txt"), "utf8")).toBe(
      "external\n",
    );
    expect(instance.status("tx-external")).toMatchObject({
      state: "paused",
      code: "recovery-required",
      externalPaths: ["b.txt"],
    });
  });

  it("preserves an edit made after currentness is checked but before mutation", async () => {
    const value = fixture("mutation-race");
    let edited = false;
    const instance = transaction(value, {
      beforeFileMutation: ({ path: changed }: { path: string }) => {
        if (changed !== "a.txt" || edited) return;
        edited = true;
        writeFileSync(path.join(value.consumerRoot, "a.txt"), "external\n");
      },
    });
    await prepare(instance, value, "tx-mutation-race");

    await expect(instance.apply("tx-mutation-race")).resolves.toMatchObject({
      ok: false,
      state: "paused",
      code: "recovery-required",
    });
    expect(readFileSync(path.join(value.consumerRoot, "a.txt"), "utf8")).toBe(
      "external\n",
    );
    expect(readFileSync(path.join(value.consumerRoot, "b.txt"), "utf8")).toBe(
      "b0\n",
    );
    expect(instance.status("tx-mutation-race")).toMatchObject({
      externalPaths: ["a.txt"],
    });
  });

  it("recovers a mutation persisted before its applied marker", async () => {
    const value = fixture("pre-marker-crash");
    let stopped = false;
    const first = transaction(value, {
      afterFileMutationBeforeSave: () => {
        if (stopped) return;
        stopped = true;
        throw new Error("simulated-pre-marker-stop");
      },
    });
    await prepare(first, value, "tx-pre-marker-crash");
    await expect(first.apply("tx-pre-marker-crash")).rejects.toThrow(
      "simulated-pre-marker-stop",
    );
    expect(first.status("tx-pre-marker-crash")).toMatchObject({
      state: "recovering",
      rollbackRetained: true,
      steps: [
        { path: "a.txt", state: "applying" },
        { path: "b.txt", state: "pending" },
      ],
    });

    const restarted = transaction(value);
    await expect(
      restarted.recover("tx-pre-marker-crash"),
    ).resolves.toMatchObject({ ok: true, state: "completed" });
    expect(readFileSync(path.join(value.consumerRoot, "a.txt"), "utf8")).toBe(
      "a1\n",
    );
    expect(readFileSync(path.join(value.consumerRoot, "b.txt"), "utf8")).toBe(
      "b1\n",
    );
  });

  it.each(["cancel", "discard"] as const)(
    "retains rollback data for pending %s until recovery settles",
    async (intent) => {
      const value = fixture(intent);
      let stopped = false;
      const first = transaction(value, {
        afterFileMutation: () => {
          if (!stopped) {
            stopped = true;
            throw new Error("simulated-process-stop");
          }
        },
      });
      const transactionId = `tx-${intent}`;
      await prepare(first, value, transactionId);
      await expect(first.apply(transactionId)).rejects.toThrow(
        "simulated-process-stop",
      );
      expect(first.requestControl(transactionId, intent)).toMatchObject({
        state: "recovering",
        pendingIntent: intent,
        rollbackRetained: true,
      });

      const restarted = transaction(value);
      await expect(restarted.recover(transactionId)).resolves.toMatchObject(
        intent === "cancel"
          ? { ok: false, state: "paused", code: "operation-cancelled" }
          : { ok: false, state: "discarded", code: "run-discarded" },
      );
      expect(readFileSync(path.join(value.consumerRoot, "a.txt"), "utf8")).toBe(
        "a0\n",
      );
      expect(readFileSync(path.join(value.consumerRoot, "b.txt"), "utf8")).toBe(
        "b0\n",
      );
      expect(restarted.status(transactionId)).toMatchObject({
        rollbackRetained: false,
      });
    },
  );

  it("rolls back only steps recorded as applied", async () => {
    const value = fixture("pending-equals-after");
    let instance!: ReturnType<typeof transaction>;
    instance = transaction(value, {
      afterFileMutation: ({ path: changed }: { path: string }) => {
        if (changed !== "a.txt") return;
        writeFileSync(path.join(value.consumerRoot, "b.txt"), "b1\n");
        instance.requestControl("tx-pending-equals-after", "cancel");
      },
    });
    await prepare(instance, value, "tx-pending-equals-after");

    await expect(
      instance.apply("tx-pending-equals-after"),
    ).resolves.toMatchObject({
      ok: false,
      state: "paused",
      code: "operation-cancelled",
    });
    expect(readFileSync(path.join(value.consumerRoot, "a.txt"), "utf8")).toBe(
      "a0\n",
    );
    expect(readFileSync(path.join(value.consumerRoot, "b.txt"), "utf8")).toBe(
      "b1\n",
    );
    expect(instance.status("tx-pending-equals-after")).toMatchObject({
      externalPaths: ["b.txt"],
      steps: [
        { path: "a.txt", state: "rolled-back" },
        { path: "b.txt", state: "pending" },
      ],
    });
  });

  it("rechecks unchanged bound paths during apply", async () => {
    const value = fixture("bound-no-op");
    const finalRevision = value.workspaces.createRevision({
      parentRevisionId: value.baseline.revisionId,
      changes: { "a.txt": Buffer.from("a1\n") },
    });
    const instance = transaction(value);
    await instance.prepare({
      transactionId: "tx-bound-no-op",
      consumerRoot: value.consumerRoot,
      baselineRevisionId: value.baseline.revisionId,
      finalRevisionId: finalRevision.revisionId,
      boundPaths: ["a.txt", "b.txt"],
      verificationFact: await verifiedRevision(value, finalRevision.revisionId),
    });
    writeFileSync(path.join(value.consumerRoot, "b.txt"), "external\n");

    await expect(instance.apply("tx-bound-no-op")).resolves.toMatchObject({
      ok: false,
      state: "paused",
      code: "recovery-required",
    });
    expect(readFileSync(path.join(value.consumerRoot, "a.txt"), "utf8")).toBe(
      "a0\n",
    );
    expect(readFileSync(path.join(value.consumerRoot, "b.txt"), "utf8")).toBe(
      "external\n",
    );
  });

  it("ignores unrelated tracked paths during final currentness checks", async () => {
    const value = fixture("unrelated-currentness");
    const finalRevision = value.workspaces.createRevision({
      parentRevisionId: value.baseline.revisionId,
      changes: { "a.txt": Buffer.from("a1\n") },
    });
    writeFileSync(path.join(value.consumerRoot, "b.txt"), "external\n");
    const instance = transaction(value);
    await expect(
      instance.prepare({
        transactionId: "tx-unrelated-currentness",
        consumerRoot: value.consumerRoot,
        baselineRevisionId: value.baseline.revisionId,
        finalRevisionId: finalRevision.revisionId,
        boundPaths: ["a.txt"],
        verificationFact: await verifiedRevision(
          value,
          finalRevision.revisionId,
        ),
      }),
    ).resolves.toMatchObject({ ok: true, state: "prepared" });
    await expect(
      instance.apply("tx-unrelated-currentness"),
    ).resolves.toMatchObject({ ok: true, state: "completed" });
    expect(readFileSync(path.join(value.consumerRoot, "a.txt"), "utf8")).toBe(
      "a1\n",
    );
    expect(readFileSync(path.join(value.consumerRoot, "b.txt"), "utf8")).toBe(
      "external\n",
    );
  });

  it("isolates post-apply verification writes from the consumer workspace", async () => {
    const value = fixture("post-apply-isolation");
    let verificationRoot = "";
    const instance = transaction(value, {
      postApply: ({ root }: { root: string }) => {
        verificationRoot = root;
        expect(root).not.toBe(value.consumerRoot);
        writeFileSync(
          path.join(root, "unbound.txt"),
          "verification side effect\n",
        );
        return { ok: true };
      },
    });
    await prepare(instance, value, "tx-post-apply-isolation");
    await expect(
      instance.apply("tx-post-apply-isolation"),
    ).resolves.toMatchObject({
      ok: true,
      state: "completed",
    });
    expect(verificationRoot).not.toBe("");
    expect(existsSync(verificationRoot)).toBe(false);
    expect(existsSync(path.join(value.consumerRoot, "unbound.txt"))).toBe(
      false,
    );
  });

  it("propagates transaction cancellation into post-apply verification", async () => {
    const value = fixture("post-apply-cancel");
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    let observedAbort = false;
    const instance = transaction(value, {
      postApply: ({ signal }: { signal: AbortSignal }) =>
        new Promise<{ ok: true }>((resolve) => {
          started();
          signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              resolve({ ok: true });
            },
            { once: true },
          );
        }),
    });
    await prepare(instance, value, "tx-post-apply-cancel");
    const applying = instance.apply("tx-post-apply-cancel");
    await running;
    instance.requestControl("tx-post-apply-cancel", "cancel");
    const recovering = instance.recover("tx-post-apply-cancel");

    await expect(applying).resolves.toMatchObject({
      ok: false,
      state: "paused",
      code: "operation-cancelled",
    });
    await expect(recovering).resolves.toMatchObject({
      ok: false,
      state: "paused",
      code: "operation-cancelled",
    });
    expect(observedAbort).toBe(true);
    expect(readFileSync(path.join(value.consumerRoot, "a.txt"), "utf8")).toBe(
      "a0\n",
    );
  });

  it("removes transaction-created parent directories after post-apply rollback", async () => {
    const value = fixture("nested-directory-rollback");
    const nestedPath = "new/deep/file.txt";
    const finalRevision = value.workspaces.createRevision({
      parentRevisionId: value.baseline.revisionId,
      changes: { [nestedPath]: Buffer.from("nested\n") },
    });
    const instance = transaction(value, {
      postApply: () => ({ ok: false, code: "post-apply-rejected" }),
    });
    await instance.prepare({
      transactionId: "tx-nested-directory-rollback",
      consumerRoot: value.consumerRoot,
      baselineRevisionId: value.baseline.revisionId,
      finalRevisionId: finalRevision.revisionId,
      boundPaths: [nestedPath],
      verificationFact: await verifiedRevision(value, finalRevision.revisionId),
    });

    await expect(
      instance.apply("tx-nested-directory-rollback"),
    ).resolves.toMatchObject({
      ok: false,
      state: "paused",
      code: "post-apply-rejected",
    });
    expect(existsSync(path.join(value.consumerRoot, nestedPath))).toBe(false);
    expect(existsSync(path.join(value.consumerRoot, "new/deep"))).toBe(false);
    expect(existsSync(path.join(value.consumerRoot, "new"))).toBe(false);
  });
});

describe("parent-owned cumulative verification", () => {
  it("verifies only a materialized revision and rejects caller-owned claims", async () => {
    const value = fixture("verification");
    const verifyCumulativeRevision = requiredExport<
      (input: Record<string, unknown>) => Promise<Record<string, unknown>>
    >("verifyCumulativeRevision");
    const failure = await verifyCumulativeRevision({
      workspaceStore: value.workspaces,
      revisionId: value.finalRevision.revisionId,
      verificationId: "change-suite",
      execute: async () => ({
        ok: false,
        kind: "verification",
        code: "introduced-failure",
      }),
    });
    expect(failure).toMatchObject({
      ok: false,
      kind: "verification",
      code: "introduced-failure",
      verificationId: "change-suite",
    });
    expect(readFileSync(path.join(value.consumerRoot, "a.txt"), "utf8")).toBe(
      "a0\n",
    );

    const instance = transaction(value);
    await expect(
      instance.prepare({
        transactionId: "tx-forged",
        consumerRoot: value.consumerRoot,
        baselineRevisionId: value.baseline.revisionId,
        finalRevisionId: value.finalRevision.revisionId,
        boundPaths: ["a.txt", "b.txt"],
        verificationFact: {
          ok: true,
          revisionId: value.finalRevision.revisionId,
          verificationId: "change-suite",
        },
      }),
    ).rejects.toThrow(/verification-fact-invalid/u);
  });
});

it("retains an unconfirmed host post-apply execution without rollback or another apply", async () => {
  const { retainExecution } = await import("../src/execution-retention.ts");
  const value = fixture("post-apply-unsettled");
  let retainedRoot = "";
  let lease: ReturnType<typeof retainExecution> | undefined;
  const instance = transaction(value, {
    awaitPostApplySettlement: true,
    postApply: ({ root }: { root: string }) => {
      retainedRoot = root;
      lease = retainExecution(value.privateRoot, [root]);
      lease.uncertain();
      return { ok: false, code: "isolation-termination-unconfirmed" };
    },
  });
  try {
    await prepare(instance, value, "tx-unsettled");
    expect(await instance.apply("tx-unsettled")).toMatchObject({
      state: "paused",
      code: "isolation-termination-unconfirmed",
    });
    expect(existsSync(retainedRoot)).toBe(true);
    expect(readFileSync(path.join(value.consumerRoot, "a.txt"), "utf8")).toBe(
      "a1\n",
    );
    expect(await instance.recover("tx-unsettled")).toMatchObject({
      state: "paused",
      code: "isolation-termination-unconfirmed",
    });
    expect(instance.status("tx-unsettled")).toMatchObject({
      rollbackRetained: true,
    });
  } finally {
    lease?.settled();
  }
});
