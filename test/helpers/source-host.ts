/** Low-level core fixtures defer the current application binding. Production never defers it. */

import { createServiceHost as createHost } from "../../src/service/host.ts";
import type { HostInput } from "../../src/service/runtime.ts";
import { root, sourceContract } from "./source-build.ts";
export function createServiceHost(input: HostInput) {
  return createHost(input, {
    contractHash: sourceContract,
    deferRuntime: true,
    webDirectory: `${root}/web/dist`,
  });
}
