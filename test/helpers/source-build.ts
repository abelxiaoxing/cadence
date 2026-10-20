import { fileURLToPath } from "node:url";
import {
  browserIdentity,
  contractIdentity,
} from "../../scripts/build-identity.mjs";

declare const __CADENCE_TEST_ROOT__: string;
declare const __CADENCE_TEST_IDENTITIES__: {
  contractHash: string;
  assets: { sourceHash: string; contractHash: string; buildId: string };
};
const frozen =
  typeof __CADENCE_TEST_IDENTITIES__ === "undefined"
    ? undefined
    : __CADENCE_TEST_IDENTITIES__;
export const root =
  typeof __CADENCE_TEST_ROOT__ === "undefined"
    ? fileURLToPath(new URL("../../", import.meta.url))
    : __CADENCE_TEST_ROOT__;
export const sourceContract = frozen?.contractHash ?? contractIdentity(root);
export const sourceBrowser = frozen?.assets ?? browserIdentity(root);
export const sourceBuild = {
  contractHash: sourceContract,
  assets: sourceBrowser,
};
export const nativeBuild = {
  kind: "native" as const,
  contractHash: sourceContract,
};
export const browserBuild = { kind: "browser" as const, ...sourceBrowser };
