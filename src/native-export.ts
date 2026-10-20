/** Explicit user-selected native export. Exclusive destination, verified stream, no overwrite. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ServiceClient } from "./service-client.ts";
import {
  ContractError,
  type ExportRequest,
  encodeExportFrame,
} from "./service-contract.ts";

export async function exportNative(
  client: ServiceClient,
  request: ExportRequest,
  destination: string,
  signal: AbortSignal,
): Promise<"complete" | "incomplete"> {
  // Preserve operational path bytes, including spaces; refuse aliases, not trim.
  if (!isAbsolute(destination) || resolve(destination) !== destination)
    throw new ContractError("invalid");
  for (let at = dirname(destination); ; at = dirname(at)) {
    const stat = await lstat(at);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new ContractError("forbidden");
    if (dirname(at) === at) break;
  }
  if (signal.aborted) throw new ContractError("unavailable");
  const file = await open(
    destination,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  const digest = createHash("sha256");
  let completed: "complete" | "incomplete" | undefined;
  try {
    // ServiceClient checks counts/sequence/scope and withholds trailer until EOF.
    for await (const frame of client.export(request, signal)) {
      const encoded = encodeExportFrame(frame, request.format);
      if (frame.event.kind === "trailer") {
        if (digest.digest("hex") !== frame.event.sha256)
          throw new ContractError("conflict");
        completed = frame.event.complete ? "complete" : "incomplete";
      } else digest.update(encoded);
      await file.writeFile(encoded, "utf8");
    }
    if (!completed || signal.aborted) throw new ContractError("unavailable");
    await file.sync();
    return completed;
  } finally {
    // On any error the partial destination is retained, never removed/replaced or
    // relabelled complete. The caller reports its exact path as unverified.
    await file.close();
  }
}
