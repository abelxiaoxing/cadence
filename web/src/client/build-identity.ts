/** Replaced by the deterministic builder, never copied from a server advertisement. */
import {
  compatibleBuild,
  type ServiceBuild,
} from "../../../src/service/contracts/build.ts";

declare const __CADENCE_BUILD__: Readonly<{
  sourceHash: string;
  contractHash: string;
  buildId: string;
}>;
export const localBuild =
  typeof __CADENCE_BUILD__ === "undefined" ? null : __CADENCE_BUILD__;
// Missing source build cannot acquire mutation compatibility.

/** A client-only refusal: no POST was dispatched and no contract change is needed. */
export const RELOAD_REQUIRED = "reload-required";
export function browserBuildCompatible(build: ServiceBuild): boolean {
  return compatibleBuild(
    build,
    localBuild ? { kind: "browser", ...localBuild } : null,
  );
}
export function assertBrowserBuildCompatible(build: ServiceBuild): void {
  if (!localBuild) throw new Error("unsupported-context");
  if (!browserBuildCompatible(build)) throw new Error(RELOAD_REQUIRED);
}
