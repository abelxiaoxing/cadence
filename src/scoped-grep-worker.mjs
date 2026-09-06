// Only matching runs here. File admission and bounded reads remain parent-owned.
// A pathological JavaScript regexp can be terminated without blocking the host.
import { parentPort } from "node:worker_threads";

parentPort.on("message", ({ pattern, path, text, maxMatches, maxBytes }) => {
  const regex = new RegExp(pattern, "u");
  const matches = [];
  let bytes = 0;
  let truncated = false;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (!regex.test(lines[index])) continue;
    const match = { path, line: index + 1, text: lines[index].slice(0, 500) };
    const size = Buffer.byteLength(JSON.stringify(match), "utf8") + 1;
    if (matches.length >= maxMatches || bytes + size > maxBytes) {
      truncated = true;
      break;
    }
    matches.push(match);
    bytes += size;
  }
  parentPort.postMessage({ matches, bytes, truncated });
});
