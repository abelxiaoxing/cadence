/** Real private records, controlled liveness; actual PID/boot/worker-stop proof
 * remains covered by self-heal's existing process fixtures. */
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hash } from "../src/service/private-files.ts";
import { RecoveryLog } from "../src/service/recovery-log.ts";
import { RepositoryCoordination } from "../src/service/repository-coordination.ts";
import { healProjectAt } from "../src/service/self-heal.ts";
import { deliveryFixture } from "./helpers/delivery-fixture.ts";

const state = vi.hoisted(() => ({ live: false }));
vi.mock("../src/service/liveness.ts", async (original) => ({
  ...(await original<object>()),
  holderState: () => ({
    state: state.live ? "live" : "dead",
    reboot: !state.live,
  }),
}));
afterEach(() => {
  state.live = false;
});
async function fixture() {
  const f = deliveryFixture();
  const lease = f.c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint: "http://127.0.0.1:31531",
    policyIdentity: "a".repeat(64),
  });
  const epoch = lease.registration.epoch;
  const resources = new RepositoryCoordination(
    f.c,
    f.root,
    epoch,
    randomUUID(),
    () => {},
    () => {},
  );
  const workspace = join(f.home, "retained-workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "partial"), "consumer partial work");
  resources.reserveWorkspace(workspace);
  await resources.mutate(
    f.binding.target.repository,
    new AbortController().signal,
    async () => {},
    () => false,
  );
  const lock = join(
    f.c.files.namespace,
    "delivery-resources-v1",
    "mutation",
    `${hash(f.binding.target.repository)}.json`,
  );
  const indices = join(
    f.c.files.namespace,
    "delivery-resources-v1",
    "owners",
    hash(f.root),
    epoch,
  );
  return { ...f, epoch, workspace, lock, indices };
}
it("a proven dead epoch releases only coordination, retains workspaces and records recovery without replay", async () => {
  const f = await fixture();
  expect((await healProjectAt(f.c, f.root, { inspect: true })).status).toBe(
    "reclaimable",
  );
  expect(existsSync(f.lock)).toBe(true);
  const result = await healProjectAt(f.c, f.root);
  expect(result.status).toBe("healed");
  expect(existsSync(f.lock)).toBe(false);
  expect(readFileSync(join(f.workspace, "partial"), "utf8")).toBe(
    "consumer partial work",
  );
  expect(f.git("rev-parse", "HEAD")).toBe(f.base);
  expect(new RecoveryLog(f.c.files).events().at(-1)?.actions).toContain(
    "released-locks",
  );
});
it("a live holder is not reclaimed, even when its shared resource is damaged", async () => {
  const f = await fixture();
  state.live = true;
  writeFileSync(f.lock, "{half");
  expect((await healProjectAt(f.c, f.root)).status).toBe("live");
  expect(readFileSync(f.lock, "utf8")).toBe("{half");
});
it("an unidentifiable shared holder needs explicit takeover; its damaged bytes are archived, not deleted", async () => {
  const f = await fixture();
  writeFileSync(f.lock, "{half-written-resource");
  expect(await healProjectAt(f.c, f.root)).toMatchObject({
    status: "blocked",
    reason: "holder-unknown",
  });
  expect(readFileSync(f.lock, "utf8")).toBe("{half-written-resource");
  const result = await healProjectAt(f.c, f.root, { takeOver: true });
  expect(result.status).toBe("healed");
  expect(existsSync(f.lock)).toBe(false);
  if (result.status !== "healed" || !result.event.archive)
    throw new Error("archive");
  const log = new RecoveryLog(f.c.files),
    archive = join(log.archiveDirectory, result.event.archive);
  const bodies = readdirSync(archive, { recursive: true }).flatMap((name) => {
    try {
      return [readFileSync(join(archive, String(name)), "utf8")];
    } catch {
      return [];
    }
  });
  expect(bodies).toContain("{half-written-resource");
  expect(readFileSync(join(f.workspace, "partial"), "utf8")).toBe(
    "consumer partial work",
  );
});
it("a torn owner index is archived after exact shared ownership proof rather than silently removed", async () => {
  const f = await fixture();
  const index = readdirSync(f.indices).find((name) =>
    name.startsWith("mutation-"),
  );
  if (!index) throw new Error("index");
  writeFileSync(join(f.indices, index), "torn creation intent");
  const result = await healProjectAt(f.c, f.root);
  expect(result.status).toBe("healed");
  if (result.status === "healed") expect(result.event.archive).not.toBeNull();
  expect(existsSync(f.lock)).toBe(false);
});

it("an epoch label cannot reclaim a shared record whose actual holder disagrees with the proven owner", async () => {
  const f = await fixture();
  const changed = JSON.parse(readFileSync(f.lock, "utf8"));
  changed.holder.pid += 1;
  const bytes = JSON.stringify(changed);
  writeFileSync(f.lock, bytes);
  expect(await healProjectAt(f.c, f.root)).toMatchObject({
    status: "blocked",
    reason: "holder-unknown",
  });
  expect(readFileSync(f.lock, "utf8")).toBe(bytes);
  expect(readFileSync(join(f.workspace, "partial"), "utf8")).toBe(
    "consumer partial work",
  );
});
