import { randomUUID } from "node:crypto";
import type { HistoryWriter } from "../history/writer.ts";
import {
  type ChooseModelRequest,
  ContractError,
  canonicalJson,
  decodeChooseModelRequest,
  decodeModelCatalog,
  decodeModelChoiceState,
  type ModelCatalog,
  type ModelChoiceState,
  type ModelSelection,
  type ModelSelector,
} from "../service-contract.ts";
import type { AccessMaterial } from "./auth.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { ServiceOwner } from "./owner.ts";

const choiceOwners = new WeakSet<ServiceOwner>();
/** Epoch RAM choice. One already loaded runtime; no task consent/auth/profile writes. */
export class OwnerModelChoice {
  private selection: ModelSelection | null = null;
  private revision: number;
  private catalogId = randomUUID();
  private installing = false;
  constructor(
    private readonly options: {
      owner: ServiceOwner;
      writer: HistoryWriter;
      models: OwnerModelContext;
      access: AccessMaterial;
      remember?(choice: ModelSelector): void;
    },
  ) {
    if (choiceOwners.has(options.owner)) throw new ContractError("conflict");
    this.revision = options.writer.configurationRevisionFloor + 1;
    if (!Number.isSafeInteger(this.revision))
      throw new ContractError("capacity");
    choiceOwners.add(options.owner);
  }
  snapshot(): ModelChoiceState {
    this.options.owner.lease.assert();
    this.options.access.assertCurrent();
    return decodeModelChoiceState({
      version: {
        epoch: this.options.owner.lease.registration.epoch,
        accessGeneration: this.options.access.generation,
        configRev: this.revision,
        catalogId: this.catalogId,
      },
      selected: this.selection,
    });
  }
  catalog(): ModelCatalog {
    const before = this.snapshot();
    const catalog = this.options.models.catalog();
    if (before.selected) this.options.models.assertCurrent(before.selected);
    if (canonicalJson(before) !== canonicalJson(this.snapshot()))
      throw new ContractError("stale");
    return decodeModelCatalog({ ...before, ...catalog });
  }
  choose(value: ChooseModelRequest): ModelChoiceState {
    const request = decodeChooseModelRequest(value);
    if (this.installing) throw new ContractError("conflict");
    const assertCurrent = () => {
      const { owner, writer, models } = this.options;
      owner.assertQuiescent();
      if (writer.quarantined) throw new ContractError("quarantine");
      if (
        writer.accounting.owner.leases ||
        writer.accounting.children.some((pool) => pool.leases) ||
        writer.pendingWrites ||
        writer.accounting.episodes.count ||
        models.pending ||
        models.loading
      )
        throw new ContractError("conflict");
      if (
        this.revision < writer.configurationRevisionFloor ||
        canonicalJson(request.expected) !==
          canonicalJson(this.snapshot().version)
      )
        throw new ContractError("stale");
    };
    assertCurrent();
    const { sourceSelectionId: _id, ...previous } = this.selection ?? {};
    // Reusing a valid current choice consumes no revision. At the ceiling only
    // an actual replacement must refuse, before any old source ID is retired.
    if (
      canonicalJson(previous) !== canonicalJson(request.choice) &&
      !Number.isSafeInteger(this.revision + 1)
    )
      throw new ContractError("capacity");
    this.installing = true;
    try {
      const selected = this.options.models.replaceSelection(
        request.choice,
        assertCurrent,
      );
      if (this.selection?.sourceSelectionId !== selected.sourceSelectionId) {
        this.selection = selected;
        ++this.revision;
        this.catalogId = randomUUID();
        this.options.owner.configurationInstalled();
      }
      this.options.remember?.(request.choice);
      return this.snapshot();
    } finally {
      this.installing = false;
    }
  }
}
