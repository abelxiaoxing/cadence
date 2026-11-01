/** Fabricated private history for scale regressions; never imports user state. */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { encodeConversationContext } from "../../src/conversation-context.mjs";
import { canonicalJson } from "../../src/service/contracts/core.ts";
import type { ChoiceVersion } from "../../src/service/contracts/models.ts";
import type { PrivateFiles } from "../../src/service/private-files.ts";
export function seedConversations(
  coordination: { directory: string; files: PrivateFiles },
  cwd: string,
  model: ChoiceVersion,
  count = 205,
  longTurns = 1,
) {
  const root = join(coordination.directory, "conversations-v1"),
    ids: string[] = [];
  let longHead = "";
  const put = (path: string, value: unknown) =>
    coordination.files.create(
      join(root, path),
      canonicalJson(value, 64 * 1024),
      64 * 1024,
    );
  for (let n = 0; n < count; n++) {
    const id = randomUUID(),
      title = `Archived conversation ${String(n).padStart(3, "0")}`;
    ids.push(id);
    const turns = Array.from({ length: n === 0 ? longTurns : 1 }, () =>
      randomUUID(),
    );
    put(`identities/${id}.json`, { schema: "cadence-conversation/1", id, cwd });
    put(`sessions/${id}.json`, {
      id,
      title,
      turns,
      checkpoint: n === 0 ? turns.at(-1) : null,
    });
    for (const [index, turnId] of turns.entries()) {
      put(`turns/${turnId}/turn.json`, {
        id: turnId,
        epoch: model.epoch,
        status: "completed",
        notice: "",
        omitted: { thinking: false, media: false, other: false },
        items: [
          {
            id: "assistant",
            role: "assistant",
            text: `Saved reply ${n}`,
            name: "",
            args: "",
            error: false,
          },
        ],
      });
      put(`turns/${turnId}/accepted.json`, {
        at: n,
        command: {
          kind: "send",
          conversationId: id,
          commandId: turnId,
          head: turns[index - 1] ?? null,
          text: title,
          model,
        },
      });
    }
    if (n === 0) {
      longHead = turns.at(-1) as string;
      coordination.files.create(
        join(root, "turns", longHead, "context.json"),
        encodeConversationContext(
          [{ role: "user", timestamp: 1, content: "seeded previous context" }],
          [],
        ),
      );
    }
  }
  return { ids, longHead };
}
