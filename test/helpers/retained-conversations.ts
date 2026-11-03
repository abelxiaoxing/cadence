/** Fabricated conversation history for scale regressions; never
 * imports user state. */
import { randomUUID } from "node:crypto";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Pi session files as the terminal writes them: `count` sessions, the
 * first with `longTurns` question/answer turns, modified oldest first. */
export function seedPiSessions(
  directory: string,
  cwd: string,
  count = 205,
  longTurns = 1,
) {
  mkdirSync(directory, { recursive: true });
  const ids: string[] = [];
  let longLeaf = "";
  for (let n = 0; n < count; n++) {
    const id = randomUUID();
    ids.push(id);
    const at = new Date(n * 1000).toISOString();
    const lines: unknown[] = [
      { type: "session", version: 3, id, timestamp: at, cwd },
    ];
    let parentId: string | null = null;
    const add = (message: unknown) => {
      const entryId = (lines.length + n * 1_000_000)
        .toString(16)
        .padStart(8, "0");
      lines.push({
        type: "message",
        id: entryId,
        parentId,
        timestamp: at,
        message,
      });
      parentId = entryId;
    };
    for (let turn = 0; turn < (n === 0 ? longTurns : 1); turn++) {
      add({
        role: "user",
        content: [
          {
            type: "text",
            text: `Terminal question ${String(n).padStart(3, "0")}.${turn}`,
          },
        ],
        timestamp: n * 1000,
      });
      add({
        role: "assistant",
        content: [{ type: "text", text: `Saved reply ${n}.${turn}` }],
        api: "openai-completions",
        provider: "fixture",
        model: "fixed",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: n * 1000,
      });
    }
    if (n === 0) longLeaf = parentId as unknown as string;
    const path = join(directory, `${at.replace(/[:.]/g, "-")}_${id}.jsonl`);
    writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    utimesSync(path, 1_000_000 + n, 1_000_000 + n);
  }
  return { ids, longLeaf };
}
