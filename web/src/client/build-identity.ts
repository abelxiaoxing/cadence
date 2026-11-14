/** Diagnostic provenance, replaced by the deterministic builder. */
declare const __CADENCE_BUILD__: Readonly<{
  sourceHash: string;
  contractHash: string;
  buildId: string;
}>;
export const localBuild =
  typeof __CADENCE_BUILD__ === "undefined" ? null : __CADENCE_BUILD__;
