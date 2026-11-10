import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ContractError } from "../src/service/contracts/core.ts";
import type { ProjectEntry } from "../src/service/contracts/gateway.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { GatewayConversations } from "../src/service/gateway-conversations.ts";
import { hash } from "../src/service/private-files.ts";

/** A selected folder no owner was ever prepared for: reading it must need no
 * execution, and must leave no private state behind. */
function selection() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gateway-files-"))),
    path = join(root, "project"),
    stateHome = join(root, "state"),
    agentDir = join(root, "agent");
  for (const directory of [path, join(path, "sub"), stateHome, agentDir])
    mkdirSync(directory, { mode: 0o700 });
  // A checkout, so its subdirectory belongs to the same project.
  expect(spawnSync("git", ["init", "-q"], { cwd: path }).status).toBe(0);
  writeFileSync(join(path, "notes.txt"), "plain notes\n");
  writeFileSync(join(path, "sub", "inner.md"), "# inner\n");
  writeFileSync(join(path, ".env"), "TOKEN=never-listed\n");
  // Redaction literals come from the account's Pi sources.
  writeFileSync(join(agentDir, "auth.json"), "{}");
  const project: ProjectEntry = {
    id: hash(path),
    path,
    cwd: path,
    epoch: null,
  };
  return {
    root,
    path,
    stateHome,
    agentDir,
    project,
    reader: new GatewayConversations(stateHome, agentDir),
  };
}
const code = (read: () => unknown) => {
  try {
    read();
  } catch (error) {
    return error instanceof ContractError ? error.code : String(error);
  }
  return "ok";
};

it("a selected folder's files are readable before any owner exists, with the owner's refusals and no private state", () => {
  const s = selection();
  const listing = s.reader.read(s.project, { kind: "files", path: "" });
  expect(listing).toMatchObject({ kind: "files", path: "", parent: null });
  expect(
    listing?.kind === "files" && listing.entries.map((entry) => entry.path),
  ).toEqual(["sub", "notes.txt"]);
  expect(s.reader.read(s.project, { kind: "file", path: "notes.txt" })).toEqual(
    { kind: "file", path: "notes.txt", text: "plain notes\n", limited: false },
  );
  // A conversation in a subdirectory of the same checkout reads from there.
  const location = { id: randomUUID(), cwd: join(s.path, "sub") };
  const nested = s.reader.read(s.project, {
    kind: "files",
    path: "",
    location,
  });
  expect(
    nested?.kind === "files" && nested.entries.map((entry) => entry.path),
  ).toEqual(["inner.md"]);
  for (const path of [".env", "../state", "/etc/hostname"])
    expect(code(() => s.reader.read(s.project, { kind: "file", path }))).toBe(
      "forbidden",
    );
  expect(
    code(() =>
      s.reader.read(s.project, {
        kind: "files",
        path: "",
        location: { id: randomUUID(), cwd: s.root },
      }),
    ),
  ).toBe("forbidden");
  // Reading selected nothing, prepared nothing and wrote nothing.
  const c = new ServiceCoordination(s.path, s.stateHome);
  expect(existsSync(c.directory)).toBe(false);
});

it("without readable redaction sources a file read refuses rather than return unredacted bytes", () => {
  const s = selection();
  const signedOut = join(s.root, "signed-out");
  mkdirSync(signedOut, { mode: 0o700 });
  const reader = new GatewayConversations(s.stateHome, signedOut);
  expect(
    code(() => reader.read(s.project, { kind: "file", path: "notes.txt" })),
  ).toBe("corrupt-selected");
});

it("an owner that is neither stopped nor absent is never read around", () => {
  const s = selection();
  const inspect = vi
    .spyOn(ServiceCoordination.prototype, "inspect")
    .mockReturnValue({ status: "unavailable" });
  try {
    expect(
      s.reader.read(
        { ...s.project, epoch: randomUUID() },
        { kind: "files", path: "" },
      ),
    ).toBeUndefined();
  } finally {
    inspect.mockRestore();
  }
});
