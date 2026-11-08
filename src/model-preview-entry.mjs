// Fixed-purpose readonly child. No owner, session, tools, boot service or SDK
// import in its parent. Private input arrives only through the anonymous pipe.

import { captureEnvironment } from "./service/model-config.ts";
import { readModelPreview } from "./service/model-preview.ts";
import {
  decodeModelPreviewInput,
  PREVIEW_INPUT_BYTES,
  PREVIEW_TIMEOUT_MS,
} from "./service/model-preview-protocol.ts";
import {
  ContractError,
  canonicalJson,
  LIMITS,
  parseWireJson,
  publicError,
} from "./service-contract.ts";

if (!process.connected) process.exit(1);
process.once("disconnect", () => process.exit(1));
process.stdout.on("error", () => process.exit(1));
const deadline = setTimeout(() => process.exit(1), PREVIEW_TIMEOUT_MS);
let reply;
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > PREVIEW_INPUT_BYTES) throw new ContractError("oversize");
    chunks.push(chunk);
  }
  const input = decodeModelPreviewInput(
    parseWireJson(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      PREVIEW_INPUT_BYTES,
    ),
  );
  const { kind: _kind, ...source } = input;
  reply = {
    kind: "ok",
    value: await readModelPreview({
      ...source,
      environment: captureEnvironment(process.env),
    }),
  };
} catch (error) {
  reply = {
    kind: "error",
    error: publicError(
      error instanceof ContractError ? error.code : "unavailable",
      "none",
    ),
  };
}
// No SDK-owned handle or timer may keep this readonly process alive afterward.
process.stdout.write(canonicalJson(reply, LIMITS.pageBytes), () => {
  clearTimeout(deadline);
  process.exit(0);
});
