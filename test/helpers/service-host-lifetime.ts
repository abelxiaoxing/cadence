// Native W1/W3 original-lifetime qualification, fake admission/role inputs only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { OwnerModelContext } from "../../src/service/model-context.ts";
import { ServiceOwner } from "../../src/service/owner.ts";
import type { WorkerPublicRequest } from "../../src/service-contract.ts";
import { admitFixtureRun, historyFixture } from "./history-fixture.ts";

const [mode, root] = process.argv.slice(2);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const stalled = deferred(),
  release = deferred();
let block = false,
  owner!: ServiceOwner;
const f = historyFixture(
  {
    onOriginal: (original, safety) => owner.trackHistory(original, safety),
    onFence: () => owner.quarantine(),
    observeWrite: async (boundary) => {
      if (block && boundary === "commit") {
        stalled.resolve();
        await release.promise;
      }
    },
  },
  root,
);
owner = new ServiceOwner(f.lease, {
  quiesce() {},
  flush: () => f.writer.flush(),
  closeListener: async () => {},
});
const agentDir = join(root, "agent");
mkdirSync(agentDir, { mode: 0o700, recursive: true });
let contacts = 0,
  response: ServerResponse | undefined;
const contacted = deferred();
const server = createServer(async (req, res) => {
  assert.equal(req.url, "/v1/oauth/token");
  let body = "";
  for await (const c of req) body += c;
  assert.equal(
    new URLSearchParams(body).get("refresh_token"),
    "fabricated-old-refresh",
  );
  contacts++;
  response = res;
  contacted.resolve();
});
await new Promise<void>((yes) => server.listen(0, "127.0.0.1", yes));
const address = server.address();
assert.ok(address && typeof address !== "string");
const credentials = {
  fixture: {
    type: "oauth",
    access: "fabricated-old-access",
    refresh: "fabricated-old-refresh",
    expires: 1,
    scope: "gateway offline_access",
  },
  unrelated: { type: "api_key", key: "fabricated-unrelated" },
};
writeFileSync(join(agentDir, "auth.json"), JSON.stringify(credentials), {
  mode: 0o600,
});
writeFileSync(
  join(agentDir, "models.json"),
  JSON.stringify({
    providers: {
      fixture: {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        api: "openai-completions",
        oauth: "radius",
        models: [{ id: "fixed", reasoning: false }],
      },
    },
  }),
  { mode: 0o600 },
);
const model = new OwnerModelContext({
  agentDir,
  home: join(root, "home"),
  cwd: f.root,
  environment: { ...process.env },
  owner,
  accounting: f.writer.auth,
});
await model.load();
f.context.model = model.select({
  provider: "fixture",
  model: "fixed",
  api: "openai-completions",
  thinking: "off",
});
f.writer.supplyContext(f.context);
assert.equal((await f.writer.commit(f.intent)).status, "committed");
await admitFixtureRun(f);
const request: WorkerPublicRequest = {
  protocol: 2,
  taskId: f.link.taskId,
  taskKind: "research",
  runId: f.link.runId,
  childRunId: f.link.childRunId,
  assignmentId: "one",
  purpose: "research",
  model: f.context.model,
  role: { role: "design-explorer", sha256: "a".repeat(64) },
  context: "Fabricated admission context; no task dispatch",
  instructions: "Read only",
  prompt: "Never launched",
  handoff: { graphRevision: 1, inputs: [] },
};
const abort = new AbortController();
if (mode === "intent-stall") block = true;
const handle = model.prepareTracked({
  request,
  operationId: randomUUID(),
  epoch: f.link.epoch,
  timeoutMs: 1000,
  signal: abort.signal,
  current: () => owner.state === "idle",
});
let settled = false;
void handle.settled.then(() => {
  settled = true;
});
if (mode === "intent-stall") {
  await stalled.promise;
  // Actual unchanged five-second writer reporting bound, not an injected shorter timer.
  assert.equal((await handle.result).status, "refused");
  assert.equal(settled, false);
  assert.equal(contacts, 0);
  assert.equal(model.pending, 1);
  const stop = await owner.stop(10);
  assert.equal(stop.state, "quarantined");
  assert.ok(stop.pending.storage > 0);
  release.resolve();
} else {
  await contacted.promise;
  abort.abort();
  assert.equal((await handle.result).status, "refused");
  const stop = await owner.stop(10);
  assert.equal(stop.state, "quarantined");
  assert.equal(stop.pending.auth, 1);
  assert.equal(settled, false);
  assert.equal(model.pending, 1);
  block = true;
  assert.ok(response);
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      access_token: "fabricated-new-access",
      refresh_token: "fabricated-new-refresh",
      expires_in: 3600,
      scope: "gateway offline_access",
    }),
  );
  await stalled.promise;
  await new Promise((yes) => setTimeout(yes, 5100));
  assert.equal(settled, false);
  assert.equal(model.pending, 1);
  const report = await owner.stop(10);
  assert.ok(report.pending.storage > 0);
  assert.equal(report.state, "quarantined");
  release.resolve();
}
await handle.settled;
assert.equal(model.pending, 0);
assert.equal(f.writer.pendingWrites, 0);
assert.equal(owner.state, "quarantined");
assert.ok(existsSync(f.c.store.lockPath));
assert.equal((await owner.stop(20)).state, "quarantined");
const after = JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8"));
assert.deepEqual(after.unrelated, credentials.unrelated);
if (mode !== "intent-stall")
  assert.equal(after.fixture.refresh, "fabricated-new-refresh");
server.closeIdleConnections();
await new Promise<void>((yes) => server.close(() => yes()));
process.stdout.write(
  `${JSON.stringify({ mode, settled, contacts, pending: model.pending, fenced: true, launched: 0 })}\n`,
);
