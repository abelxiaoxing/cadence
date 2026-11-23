/** Persistent, credential-free conversation settings and immutable admission snapshots.
 * Reading never initializes a context or restores a model. Checkout ownership stays
 * in ServiceCoordination/CheckoutGate, independently of a conversation's cwd. */

import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CadencePreferences } from "../cadence-preferences.ts";
import { conversationIdentity } from "../conversation-identity.ts";
import { sanitizeText } from "../worker-redaction.mjs";
import { absent, resolveWorkspace, withinWorkspace } from "../workspace.ts";
import {
  ContractError,
  canonicalJson,
  closed,
  parseWireJson,
} from "./contracts/core.ts";
import { decodeModelSelector, type ModelSelector } from "./contracts/domain.ts";
import {
  type ChoiceVersion,
  type ConversationContext,
  type ConversationLocation,
  catalogOffers,
  decodeConversationContext,
  decodeConversationLocation,
  decodeSessionId,
  type ExecutionContext,
  type ModelCatalog,
  type ModelChoiceState,
} from "./contracts/models.ts";
import { assertSupportedConversation } from "./conversation-records.ts";
import type { ServiceCoordination } from "./coordination.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { ServiceOwner } from "./owner.ts";
import type { PiSessions } from "./pi-sessions.ts";
import type { FileSnapshot } from "./private-files.ts";

const BYTES = 16 * 1024;
const SCHEMA = "cadence-conversation-context/1";
export class ConversationContextRecords {
  constructor(
    private readonly c: ServiceCoordination,
    private readonly sessions?: PiSessions,
  ) {}
  path(id: string) {
    return join(
      this.c.directory,
      "conversations-v1",
      "contexts",
      `${decodeSessionId(id)}.json`,
    );
  }
  read(location: ConversationLocation): {
    context: ConversationContext;
    file?: FileSnapshot;
  } {
    const input = decodeConversationLocation(location);
    assertSupportedConversation(this.c, input.id);
    const file = this.c.files.read(this.path(input.id), BYTES);
    let context: ConversationContext;
    if (file) {
      const v = closed(parseWireJson(file.bytes.toString("utf8"), BYTES), [
        "schema",
        "context",
      ]);
      if (v.schema !== SCHEMA) throw new ContractError("corrupt-selected");
      context = decodeConversationContext(v.context);
      if (context.id !== input.id) throw new ContractError("corrupt-selected");
    } else
      context = {
        id: input.id,
        cwd: input.cwd,
        revision: 0,
        model: null,
      };
    this.sessions?.directoryFor(context.cwd);
    const session = this.sessions?.find(input.id);
    if (session) {
      if (file && context.cwd !== session.summary.cwd)
        throw new ContractError("corrupt-selected");
      context.cwd = session.summary.cwd;
    }
    if (
      resolve(context.cwd) !== context.cwd ||
      !withinWorkspace(this.c.store.root, context.cwd)
    )
      throw new ContractError("forbidden");
    this.c.files.assert(this.path(input.id), file, BYTES);
    return { context, file };
  }
}
interface VerifiedGitRoot {
  root: string;
  gitDev: number;
  gitIno: number;
  headDev: number;
  headIno: number;
  configStamp: string;
}
function readGitRootStamp(root: string): VerifiedGitRoot | null {
  try {
    const git = lstatSync(join(root, ".git"));
    if (!git.isDirectory() || git.isSymbolicLink()) return null;
    const head = lstatSync(join(root, ".git", "HEAD"));
    if (!head.isFile() || head.isSymbolicLink()) return null;
    const config = lstatSync(join(root, ".git", "config"));
    if (!config.isFile() || config.isSymbolicLink()) return null;
    return {
      root,
      gitDev: git.dev,
      gitIno: git.ino,
      headDev: head.dev,
      headIno: head.ino,
      configStamp: `${config.dev}:${config.ino}:${config.size}:${config.ctimeMs}:${config.mtimeMs}`,
    };
  } catch {
    return null;
  }
}
/** Fast-path verification when a previously confirmed `.git` directory checkout
 * and every intermediate ancestor between `cwd` and `root` are unchanged. Any
 * mismatch, symlink, worktree `.git` file or nested `.git` falls back to git. */
function fastVerifiedGitDirectory(
  root: string,
  cwd: string,
  verified: VerifiedGitRoot | null,
): boolean {
  if (!verified || verified.root !== root) return false;
  try {
    if (realpathSync(cwd) !== cwd || !withinWorkspace(root, cwd)) return false;
    const current = readGitRootStamp(root);
    if (
      !current ||
      current.gitDev !== verified.gitDev ||
      current.gitIno !== verified.gitIno ||
      current.headDev !== verified.headDev ||
      current.headIno !== verified.headIno ||
      current.configStamp !== verified.configStamp
    )
      return false;
    let at = cwd;
    while (at !== root) {
      try {
        lstatSync(join(at, ".git"));
        return false;
      } catch (error) {
        if (!absent(error)) return false;
      }
      const parent = dirname(at);
      if (parent === at) return false;
      at = parent;
    }
    return true;
  } catch {
    return false;
  }
}
/** A conversation's directory is exactly one existing directory of this
 * checkout, named by a path that needs no redaction. The live owner and the
 * stopped-owner readers share this rule. */
export function assertConversationDirectory(
  root: string,
  cwd: string,
  secrets?: readonly string[],
  verifiedGit?: { current: VerifiedGitRoot | null },
): void {
  if (!fastVerifiedGitDirectory(root, cwd, verifiedGit?.current ?? null)) {
    let actual: ReturnType<typeof resolveWorkspace>;
    try {
      actual = resolveWorkspace(cwd);
    } catch {
      throw new ContractError("stale");
    }
    if (actual.cwd !== cwd || actual.root !== root)
      throw new ContractError("stale");
    if (verifiedGit) verifiedGit.current = readGitRootStamp(root);
  }
  if (secrets && sanitizeText(cwd, secrets) !== cwd)
    throw new ContractError("forbidden");
}
export class ConversationContexts {
  readonly records: ConversationContextRecords;
  private readonly seed = randomUUID();
  private readonly verifiedGit: { current: VerifiedGitRoot | null } = {
    current: null,
  };
  private preferencePending: ModelSelector | null = null;
  private preferenceInFlight: ModelSelector | null = null;
  private preferenceWrite: Promise<void> | undefined;
  constructor(
    private readonly o: {
      coordination: ServiceCoordination;
      owner: ServiceOwner;
      models: OwnerModelContext;
      choice: OwnerModelChoice;
      cwd: string;
      agentDir?: string;
      sessions?: PiSessions;
      secrets(): readonly string[];
    },
  ) {
    this.records = new ConversationContextRecords(o.coordination, o.sessions);
  }
  private current(cwd: string, checkSecrets = true) {
    this.o.owner.lease.assert();
    if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
    assertConversationDirectory(
      this.o.coordination.store.root,
      cwd,
      checkSecrets ? this.o.secrets() : undefined,
      this.verifiedGit,
    );
  }
  private queuePreference(model: ModelSelector): void {
    if (!this.o.agentDir) return;
    this.preferencePending = model;
    if (this.preferenceWrite) return;
    const agentDir = this.o.agentDir;
    const run = (async () => {
      while (this.preferencePending) {
        const next = this.preferencePending;
        this.preferencePending = null;
        this.preferenceInFlight = next;
        try {
          await new CadencePreferences(agentDir).saveAsync(next);
        } catch {
          /* Best effort; the conversation selection is authoritative. */
        } finally {
          this.preferenceInFlight = null;
        }
      }
    })().finally(() => {
      if (this.preferenceWrite === run) this.preferenceWrite = undefined;
      if (this.preferencePending) this.queuePreference(this.preferencePending);
    });
    this.preferenceWrite = run;
  }
  async flushPreferences(): Promise<void> {
    while (this.preferenceWrite) await this.preferenceWrite;
  }
  directory(location?: ConversationLocation): string {
    const cwd = location ? this.records.read(location).context.cwd : this.o.cwd;
    this.current(cwd);
    return cwd;
  }
  private snapshotOf(context: ConversationContext): ModelChoiceState {
    const selected = context.model
      ? this.o.models.retainedSelection(context.model)
      : null;
    const owner = this.o.choice.snapshot().version;
    return {
      selected,
      version: {
        epoch: owner.epoch,
        accessGeneration: owner.accessGeneration,
        configRev: context.revision + 1,
        catalogId: conversationIdentity(
          `cadence-context-version:${canonicalJson([this.seed, this.o.models.catalogGeneration ?? 0, context, selected?.sourceSelectionId ?? null])}`,
        ),
        conversation: { id: context.id, cwd: context.cwd },
      },
    };
  }
  snapshot(location: ConversationLocation): ModelChoiceState {
    this.o.owner.lease.assert();
    const { context } = this.records.read(location);
    return this.snapshotOf(context);
  }
  catalog(location: ConversationLocation): ModelCatalog {
    this.o.owner.lease.assert();
    const { context, file } = this.records.read(location);
    const before = this.snapshotOf(context);
    const catalog = this.o.models.catalog();
    if (before.selected)
      this.o.models.assertCurrent(before.selected, "installed");
    this.o.owner.lease.assert();
    this.o.coordination.files.assert(
      this.records.path(context.id),
      file,
      BYTES,
    );
    if (canonicalJson(before) !== canonicalJson(this.snapshotOf(context)))
      throw new ContractError("stale");
    let remembered: ModelSelector | null = context.model;
    if (!remembered) {
      const queued = this.preferencePending ?? this.preferenceInFlight;
      if (queued) remembered = queued;
      else if (this.o.agentDir)
        try {
          remembered = new CadencePreferences(this.o.agentDir).read();
        } catch {
          /* No fallback installation. */
        }
    }
    if (remembered && !catalogOffers(catalog.entries, remembered))
      remembered = null;
    return { ...before, ...catalog, remembered };
  }
  choose(
    location: ConversationLocation,
    expected: ChoiceVersion,
    value: ModelSelector,
    remember = true,
  ): ModelChoiceState {
    const input = decodeConversationLocation(location);
    const { context, file } = this.records.read(input);
    this.current(input.cwd);
    const before = this.snapshotOf(context);
    if (
      context.cwd !== input.cwd ||
      canonicalJson(expected) !== canonicalJson(before.version)
    )
      throw new ContractError("stale");
    const model = decodeModelSelector(value);
    const changed =
      !file || canonicalJson(context.model) !== canonicalJson(model);
    if (changed && context.revision >= Number.MAX_SAFE_INTEGER - 1)
      throw new ContractError("capacity");
    // Preflight bytes/revision before installing any runtime source. Restoring
    // an unchanged preference never rewrites its durable context record.
    const next = changed
      ? decodeConversationContext({
          ...context,
          model,
          revision: context.revision + 1,
        })
      : null;
    const body = next
      ? canonicalJson({ schema: SCHEMA, context: next }, BYTES)
      : null;
    this.o.models.retainSelection(model);
    this.o.coordination.files.assert(this.records.path(input.id), file, BYTES);
    if (body !== null) {
      try {
        if (file)
          this.o.coordination.files.replace(
            this.records.path(input.id),
            file,
            body,
            BYTES,
          );
        else
          this.o.coordination.files.create(
            this.records.path(input.id),
            body,
            BYTES,
          );
      } catch (error) {
        this.o.owner.quarantine();
        throw error;
      }
    }
    if (remember && this.o.agentDir) this.queuePreference(model);
    this.o.owner.lease.assert();
    return this.snapshotOf(next ?? context);
  }
  restore(
    location: ConversationLocation,
    expected?: ChoiceVersion,
    intended?: ModelSelector,
  ): ModelChoiceState {
    this.o.owner.lease.assert();
    const { context } = this.records.read(location);
    const before = this.snapshotOf(context);
    if (expected && canonicalJson(expected) !== canonicalJson(before.version))
      throw new ContractError("stale");
    if (
      context.model &&
      intended &&
      canonicalJson(context.model) !== canonicalJson(intended)
    )
      throw new ContractError("stale");
    if (before.selected) return before;
    const selected =
      context.model ??
      intended ??
      this.preferencePending ??
      this.preferenceInFlight ??
      (this.o.agentDir ? new CadencePreferences(this.o.agentDir).read() : null);
    if (!selected) throw new ContractError("unavailable");
    return this.choose(location, before.version, selected, false);
  }
  /** Low-level native requests may explicitly use the owner's default slot.
   * Native Pi and browser conversations always use their own location. */
  capture(version: ChoiceVersion, reply = false): ExecutionContext {
    const state = version.conversation
      ? this.snapshot(version.conversation)
      : this.o.choice.snapshot();
    const cwd = version.conversation?.cwd ?? resolveWorkspace(this.o.cwd).cwd;
    // Exit records no model execution and must work even when model sources
    // are unusable. Its fixed message/cwd are not a model-auth operation.
    this.current(cwd, !reply);
    if (
      canonicalJson(version) !== canonicalJson(state.version) ||
      (!state.selected && !reply)
    )
      throw new ContractError("stale");
    if (state.selected && !reply) this.o.models.assertCurrent(state.selected);
    return {
      cwd,
      checkoutRoot: this.o.coordination.store.root,
      version: structuredClone(version),
      model: !reply && state.selected ? { ...state.selected } : null,
    };
  }
}
