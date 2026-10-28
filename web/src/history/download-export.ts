/* Adapted from pi-web-ui download.ts attachment initiation UX; MIT (c) 2026 xing-shuyin.
 * No arbitrary filesystem path, token URL, Blob archive buffer or service worker. */

import { decodeExportRequest } from "../../../src/service-contract.ts";
import { wireRequest } from "../../../src/service-wire.ts";
import { projectPrefix } from "../client/project-route";
import type { ExportRequest } from "../types";
export function requestDownload(input: ExportRequest): void {
  const wire = wireRequest("download", decodeExportRequest(input));
  if (wire.method !== "GET")
    throw new Error("Native download needs the named GET attachment route.");
  const link = document.createElement("a");
  link.href = projectPrefix() + wire.path;
  link.download = `cadence-${input.scope.kind}-${input.scope.id}.${input.format === "markdown" ? "md" : "ndjson"}`;
  link.referrerPolicy = "no-referrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
