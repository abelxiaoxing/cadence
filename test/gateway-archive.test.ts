// The stopped-owner reader honours the owner's archive records. The owner's
// stopped state is fabricated: its selection and host configuration are
// observed through controlled reads, everything below them is the real reader.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AccessMaterial } from "../src/service/auth.ts";
import type { ProjectEntry } from "../src/service/contracts/gateway.ts";
import { decodeWorkbenchResult } from "../src/service/contracts/workbench.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { GatewayConversations } from "../src/service/gateway-conversations.ts";
import { sessionDirectory } from "../src/service/pi-sessions.ts";
import { hash } from "../src/service/private-files.ts";
import { readHostConfig } from "../src/service/runtime.ts";
import { seedPiSessions } from "./helpers/retained-conversations.ts";

vi.mock("../src/service/runtime.ts", () => ({ readHostConfig: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

function tree(path: string): string {
  const digest = createHash("sha256");
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = join(directory, entry.name);
      digest.update(name);
      if (entry.isDirectory()) visit(name);
      else digest.update(readFileSync(name));
    }
  };
  visit(path);
  return digest.digest("hex");
}

it("a stopped owner's archived conversations stay out of the history and are listed on request, without a write", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gateway-archive-"))),
    path = join(root, "project"),
    stateHome = join(root, "state"),
    agentDir = join(root, "agent");
  for (const directory of [path, stateHome, agentDir])
    mkdirSync(directory, { mode: 0o700 });
  expect(spawnSync("git", ["init", "-q"], { cwd: path }).status).toBe(0);
  writeFileSync(join(agentDir, "auth.json"), "{}");
  const c = new ServiceCoordination(path, stateHome);
  AccessMaterial.initialize(c.files, c.directory);
  for (const name of ["registration.json", "host-config.json"] as const)
    c.files.create(c.path(name), "{}");
  const epoch = randomUUID();
  vi.spyOn(ServiceCoordination.prototype, "inspect").mockReturnValue({
    status: "stopped",
    epoch,
  });
  vi.mocked(readHostConfig).mockReturnValue({
    agentDir,
    tokenSource: "generated",
    tokenFile: null,
  } as ReturnType<typeof readHostConfig>);
  const seeded = seedPiSessions(sessionDirectory(path, agentDir), path, 4);
  const [kept, hidden] = seeded.ids;
  c.files.create(
    join(c.directory, "conversations-v1", "archive", `${hidden}.json`),
    JSON.stringify({
      schema: "cadence-conversation-archive/1",
      id: hidden,
      at: 1,
    }),
  );
  const project: ProjectEntry = { id: hash(path), path, cwd: path, epoch };
  const reader = new GatewayConversations(stateHome, agentDir);
  const before = tree(root);
  const list = (archived?: true) => {
    const page = reader.read(project, {
      kind: "conversations",
      ...(archived ? { archived } : {}),
    });
    if (page?.kind !== "conversations") throw Error("listing");
    return decodeWorkbenchResult(page) as typeof page;
  };
  expect(
    list()
      .entries.map((entry) => entry.id)
      .sort(),
  ).toEqual(seeded.ids.filter((id) => id !== hidden).sort());
  expect(list().entries.some((entry) => "archived" in entry)).toBe(false);
  expect(list(true).entries).toMatchObject([{ id: hidden, archived: true }]);
  // A direct link still opens it and says it is archived.
  expect(
    reader.read(project, {
      kind: "conversation",
      id: hidden,
      leaf: null,
      known: null,
    }),
  ).toMatchObject({ summary: { id: hidden, archived: true }, turns: 1 });
  expect(
    reader.read(project, {
      kind: "conversation",
      id: kept,
      leaf: null,
      known: null,
    }),
  ).not.toHaveProperty("summary.archived");
  expect(tree(root)).toBe(before);
});
