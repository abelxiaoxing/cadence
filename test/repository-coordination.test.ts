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
import { ServiceCoordination } from "../src/service/coordination.ts";
import { hash } from "../src/service/private-files.ts";
import {
  RepositoryCoordination,
  recoverDeliveryResources,
} from "../src/service/repository-coordination.ts";
import { deliveryFixture } from "./helpers/delivery-fixture.ts";

afterEach(() => vi.restoreAllMocks());
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
it("different checkout owners serialize the same repository and cancellation does not refund an active original", async () => {
  const f = deliveryFixture(),
    start = deferred(),
    close = deferred();
  const second = new RepositoryCoordination(
    f.c,
    join(f.root, "other-owner"),
    randomUUID(),
    randomUUID(),
    () => {},
    () => {},
  );
  const abort = new AbortController();
  let done = false;
  const first = f.resources
    .mutate(
      f.binding.target.repository,
      abort.signal,
      async () => {
        start.resolve();
        await close.promise;
      },
      () => true,
    )
    .then(() => {
      done = true;
    });
  await start.promise;
  abort.abort();
  const waiting = new AbortController();
  const body = vi.fn();
  const next = second.mutate(
    f.binding.target.repository,
    waiting.signal,
    body,
    () => true,
  );
  const observed = next.catch((e) => e);
  waiting.abort();
  expect(await observed).toBeInstanceOf(Error);
  expect(body).not.toHaveBeenCalled();
  expect(done).toBe(false);
  close.resolve();
  await first;
  await second.mutate(
    f.binding.target.repository,
    new AbortController().signal,
    body,
    () => true,
  );
  expect(body).toHaveBeenCalledTimes(1);
});
it("unconfirmed settlement keeps its lease; exact recovered epoch releases coordination only, never workspace data", async () => {
  const f = deliveryFixture();
  const path = await f.create();
  writeFileSync(join(path, "partial"), "consumer evidence");
  await f.resources.mutate(
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
  expect(existsSync(lock)).toBe(true);
  expect(recoverDeliveryResources(f.c.files, f.root, randomUUID())).toBe(0);
  expect(existsSync(lock)).toBe(true);
  expect(recoverDeliveryResources(f.c.files, f.root, f.epoch)).toBe(2);
  expect(existsSync(lock)).toBe(false);
  expect(readFileSync(join(path, "partial"), "utf8")).toBe("consumer evidence");
  expect(f.git("rev-parse", f.view.taskBranch)).toBe(f.base);
});
it("an explicit project open cannot adopt a managed task workspace or its parent", async () => {
  const f = deliveryFixture();
  await f.create();
  for (const root of [
    f.view.worktreeRoot,
    join(f.state, "cadence-worktrees-v1"),
  ]) {
    const c = new ServiceCoordination(root, f.state);
    expect(() =>
      c.acquire({
        schema: "cadence-service-owner-config/1",
        endpoint: "http://127.0.0.1:31999",
        policyIdentity: "a".repeat(64),
      }),
    ).toThrow("forbidden");
    expect(existsSync(c.path("registration.json"))).toBe(false);
  }
  f.delivery.finish();
});
it("failed ownership publication quarantines rather than leaving a live owner with an invisible retained lock", async () => {
  const f = deliveryFixture();
  const create = f.c.files.create.bind(f.c.files);
  vi.spyOn(f.c.files, "create").mockImplementation((path, body, max) => {
    if (path.includes(join("delivery-resources-v1", "mutation")))
      throw new Error("synthetic partial persistence failure");
    return create(path, body, max);
  });
  await expect(
    f.resources.mutate(
      f.binding.target.repository,
      new AbortController().signal,
      async () => {},
      () => true,
    ),
  ).rejects.toThrow("partial persistence");
  expect(f.fault()).toBe(true);
  expect(
    readdirSync(
      join(
        f.c.files.namespace,
        "delivery-resources-v1",
        "owners",
        hash(f.root),
        f.epoch,
      ),
    ),
  ).toHaveLength(1);
});
it("resource identity rejects replacement even if another .git marker names the same repository", async () => {
  const f = deliveryFixture();
  const path = join(f.home, "selected");
  mkdirSync(path);
  writeFileSync(join(path, ".git"), "gitdir: original\n");
  const token = f.resources.reserveWorkspace(path);
  f.resources.confirmWorkspace(token);
  writeFileSync(join(path, ".git"), "gitdir: substituted\n");
  expect(() => f.resources.assertWorkspace(token)).toThrow("stale");
  f.resources.finish();
});
