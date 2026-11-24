/** Backups of uncommitted changes are let go at startup, long after their run
 * settled, and only by the exact commit recorded for them. Real Git and the
 * real private store; no run is started. */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RecoveryLog } from "../src/service/recovery-log.ts";
import { wipBackupRef } from "../src/service/workflow-landing.ts";
import { Workflows } from "../src/service/workflows.ts";
import { deliveryFixture } from "./helpers/delivery-fixture.ts";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";

const DAY = 24 * 60 * 60 * 1000;

it("a backup reference is deleted 30 days after its run settled, only while it holds the recorded commit; anything else is left, and a damaged record is archived", () => {
  const f = deliveryFixture();
  const lease = f.c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint: "http://127.0.0.1:31418",
    policyIdentity: "a".repeat(64),
  });
  try {
    const directory = join(f.c.directory, "workflows-v1", "wip-backups");
    const head = f.git("rev-parse", "HEAD");
    f.git("commit", "-q", "--allow-empty", "-m", "another commit");
    const other = f.git("rev-parse", "HEAD");
    const record = (
      settledAgo: number | null,
      held: string | null,
      extra: object = {},
    ) => {
      const run = randomUUID();
      const ref = wipBackupRef(run);
      if (held) f.git("update-ref", ref, held);
      f.c.files.create(
        join(directory, `${run}.json`),
        JSON.stringify({
          ref,
          oid: head,
          repository: f.root,
          worktree: f.root,
          at: Date.now() - 40 * DAY,
          status: "confirmed",
          ...(settledAgo === null
            ? {}
            : { settledAt: Date.now() - settledAgo }),
          ...extra,
        }),
      );
      return { run, ref, path: join(directory, `${run}.json`) };
    };
    const due = record(31 * DAY, head);
    // Taken long ago, but its run settled only recently.
    const recent = record(29 * DAY, head);
    // Its run never recorded a settlement: its own age counts.
    const unsettled = record(null, head);
    // Somebody put another commit under the name: not ours to delete.
    const foreign = record(31 * DAY, other);
    // Already gone: nothing is left to protect.
    const gone = record(31 * DAY, null);
    const damaged = join(directory, `${randomUUID()}.json`);
    writeFileSync(damaged, "{ not json", { mode: 0o600 });
    const mismatched = record(31 * DAY, head, { ref: "refs/heads/main" });

    new Workflows({
      cwd: f.root,
      coordination: f.c,
      owner: {
        lease,
        state: "idle",
        quarantine() {},
        trackConversation() {},
        trackConversationProcess() {},
      },
      contexts: { capture: () => ({}) },
      models: { workerSettings: () => fixtureRuntime(), assertCurrent() {} },
      secrets: () => [],
    } as unknown as ConstructorParameters<typeof Workflows>[0]);

    const held = (ref: string) => {
      try {
        return f.git("rev-parse", "--verify", "--quiet", ref);
      } catch {
        return null;
      }
    };
    expect(held(due.ref)).toBeNull();
    expect(existsSync(due.path)).toBe(false);
    expect(held(unsettled.ref)).toBeNull();
    expect(existsSync(unsettled.path)).toBe(false);
    expect(held(recent.ref)).toBe(head);
    expect(existsSync(recent.path)).toBe(true);
    // Left exactly as found, and not asked about again.
    expect(held(foreign.ref)).toBe(other);
    expect(
      JSON.parse(f.c.files.read(foreign.path)!.bytes.toString("utf8")),
    ).toMatchObject({ oid: head, left: "holds another commit" });
    expect(existsSync(gone.path)).toBe(false);
    // A record that is not a backup record is moved aside, never acted on.
    expect(existsSync(damaged)).toBe(false);
    expect(existsSync(mismatched.path)).toBe(false);
    expect(held(mismatched.ref)).toBe(head);
    expect(f.git("rev-parse", "refs/heads/main")).toBe(other);
    const log = new RecoveryLog(f.c.files);
    const archived = readdirSync(log.archiveDirectory).flatMap((entry) =>
      readdirSync(join(log.archiveDirectory, entry)),
    );
    expect(archived).toHaveLength(2);
    expect(log.events()[0]).toMatchObject({
      scope: "project",
      path: f.root,
      cause: "storage",
      actions: ["archived-state"],
    });
  } finally {
    f.delivery.finish();
    lease.release();
  }
});
