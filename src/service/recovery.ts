import type {
  DurableRecoveryFact,
  HistoryRecovery,
} from "../history/recovery.ts";
import { ContractError, decodeHash } from "../service-contract.ts";
import {
  recoveryOwnerStatus,
  type ServiceCoordination,
} from "./coordination.ts";

export interface RecoveryHistoryFacts {
  /** Exact affected committed/uncommitted bytes, not a projection version. */
  digest: string;
  processes: "externally-resolved" | "unknown";
  credentials: "independently-resolved" | "unknown";
  storage: "independently-resolved" | "unknown";
}
export interface RecoveryInspectionPort {
  inspect(epoch: string): Promise<RecoveryHistoryFacts>;
}
export interface RecoveryInspection {
  epoch: string;
  coordinationDigest: string;
  history: RecoveryHistoryFacts | null;
  owner: "live" | "absent" | "ambiguous";
  resolution: "local-interactive-only";
}
export async function inspectRecovery(
  coordination: ServiceCoordination,
  history?: RecoveryInspectionPort,
): Promise<RecoveryInspection> {
  const selected = coordination.recoverySnapshot();
  const facts = history
    ? await history.inspect(selected.registration.epoch)
    : null;
  if (facts) decodeHash(facts.digest);
  if (coordination.recoverySnapshot().digest !== selected.digest)
    throw new ContractError("conflict");
  return {
    epoch: selected.registration.epoch,
    coordinationDigest: selected.digest,
    history: facts,
    owner: recoveryOwnerStatus(
      selected.registration.pid,
      selected.registration.host,
    ),
    resolution: "local-interactive-only",
  };
}
export interface LocalRecoveryConfirmation {
  expected: RecoveryInspection;
  acknowledgeEscapedProcesses: true;
  processes: "externally-resolved";
  credentials: "independently-resolved";
  storage: "independently-resolved";
  /** Native management adapter's expiring exact-resource capability, NOT a body
   * boolean, browser claim, history cursor, or local HTTP token. */
  assertLocalAuthority(choice: RecoveryInspection): void;
}
export interface RecoveryResolution {
  status: "resolved";
  epoch: string;
  recoveryId: string;
  committedSeq: string;
  notice: "operator-acknowledgment-not-certification";
}
export async function resolveRecovery(
  coordination: ServiceCoordination,
  confirmation: LocalRecoveryConfirmation,
  history: HistoryRecovery,
): Promise<RecoveryResolution> {
  if (
    typeof confirmation.assertLocalAuthority !== "function" ||
    confirmation.acknowledgeEscapedProcesses !== true ||
    confirmation.processes !== "externally-resolved" ||
    confirmation.credentials !== "independently-resolved" ||
    confirmation.storage !== "independently-resolved"
  )
    throw new ContractError("forbidden");
  const expected = structuredClone(confirmation.expected);
  const authority = () =>
    confirmation.assertLocalAuthority(structuredClone(expected));
  authority();
  const release = coordination.prepareRecoveryRelease(
    expected.coordinationDigest,
    authority,
  );
  const current = await inspectRecovery(coordination, history);
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new ContractError("conflict");
  if (current.owner !== "absent" || !current.history)
    throw new ContractError("quarantine");
  // Await the ORIGINAL append, including flush/descriptor close. There is no
  // reporting race whose timeout could release locks while that write continues.
  const fact: DurableRecoveryFact = await history.append({
    ...confirmation,
    expected,
  });
  authority();
  if (
    fact.epoch !== expected.epoch ||
    fact.coordinationDigest !== expected.coordinationDigest ||
    fact.historyDigest !== expected.history?.digest
  )
    throw new ContractError("conflict");
  // No repaired outcomes, replay, auth refresh or migration. A crash/failure here
  // preserves the bridge plus remaining fences and is explicitly partial/refused.
  release(() => history.assertCommitted(fact));
  return {
    status: "resolved",
    epoch: fact.epoch,
    recoveryId: fact.recoveryId,
    committedSeq: fact.committedSeq,
    notice: "operator-acknowledgment-not-certification",
  };
}
