/** Replaced by the deterministic builder, never copied from a server advertisement. */
declare const __CADENCE_BUILD__: Readonly<{
  sourceHash: string;
  contractHash: string;
  buildId: string;
}>;
export const localBuild =
  typeof __CADENCE_BUILD__ === "undefined" ? null : __CADENCE_BUILD__;
// Missing source build cannot acquire mutation compatibility.
