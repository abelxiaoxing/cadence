/** Persistent, credential-free conversation settings and immutable admission snapshots.
 * Reading never initializes a context or restores a model. Checkout ownership stays
 * in ServiceCoordination/CheckoutGate, independently of a conversation's cwd. */

import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { CadencePreferences } from "../cadence-preferences.ts";
import { conversationIdentity } from "../conversation-identity.ts";
import { sanitizeText } from "../worker-redaction.mjs";
import { resolveWorkspace, withinWorkspace } from "../workspace.ts";
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
/** A conversation's directory is exactly one existing directory of this
 * checkout, named by a path that needs no redaction. The live owner and the
 * stopped-owner readers share this rule. */
export function assertConversationDirectory(
  root: string,
  cwd: string,
  secrets?: readonly string[],
): void {
  let actual: ReturnType<typeof resolveWorkspace>;
  try {
    actual = resolveWorkspace(cwd);
  } catch {
    throw new ContractError("stale");
  }
  if (actual.cwd !== cwd || actual.root !== root)
    throw new ContractError("stale");
  if (secrets && sanitizeText(cwd, secrets) !== cwd)
    throw new ContractError("forbidden");
}
export class ConversationContexts {
  readonly records: ConversationContextRecords;
  private readonly seed = randomUUID();
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
    );
  }
  directory(location?: ConversationLocation): string {
    const cwd = location ? this.records.read(location).context.cwd : this.o.cwd;
    this.current(cwd);
    return cwd;
  }
  snapshot(location: ConversationLocation): ModelChoiceState {
    this.o.owner.lease.assert();
    const { context } = this.records.read(location);
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
          `cadence-context-version:${canonicalJson([this.seed, context, selected?.sourceSelectionId ?? null])}`,
        ),
        conversation: { id: context.id, cwd: context.cwd },
      },
    };
  }
  catalog(location: ConversationLocation): ModelCatalog {
    const before = this.snapshot(location);
    const { context } = this.records.read(location);
    const catalog = this.o.models.catalog();
    if (before.selected) this.o.models.assertCurrent(before.selected);
    if (canonicalJson(before) !== canonicalJson(this.snapshot(location)))
      throw new ContractError("stale");
    let remembered: ModelSelector | null = context.model;
    if (!remembered && this.o.agentDir)
      try {
        remembered = new CadencePreferences(this.o.agentDir).read();
      } catch {
        /* No fallback installation. */
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
    const before = this.snapshot(input);
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
    try {
      if (remember && this.o.agentDir)
        new CadencePreferences(this.o.agentDir).save(model);
    } catch {
      /* Best effort; the conversation selection is authoritative. */
    }
    return this.snapshot(input);
  }
  restore(
    location: ConversationLocation,
    expected?: ChoiceVersion,
    intended?: ModelSelector,
  ): ModelChoiceState {
    const before = this.snapshot(location);
    if (expected && canonicalJson(expected) !== canonicalJson(before.version))
      throw new ContractError("stale");
    const { context } = this.records.read(location);
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
