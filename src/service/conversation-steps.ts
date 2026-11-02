/** A conversation turn's steps, listed from its record: an unpaged turn from
 * its own items; a paged turn from its immutable transcript pages, followed by
 * the preview of items no page holds yet (work still in progress). */
import { ContractError } from "./contracts/core.ts";
import {
  type ChatItem,
  type ChatStep,
  type ChatTurn,
  chatStep,
  clipText,
  STEP_TEXT_BYTES,
} from "./contracts/workbench.ts";

// Arguments read to name a tool's target; longer ones name nothing.
const TARGET_ARGS = 1024 * 1024;
// Read cache only: an evicted index is rebuilt from the same immutable pages.
const INDEXED_TURNS = 32;

/** Where a listed step's full item is stored. */
type Source =
  | { kind: "item"; index: number }
  | { kind: "pages"; first: number }
  | { kind: "preview"; id: string };
export interface ListedStep {
  step: ChatStep;
  source: Source;
}
interface PageIndex {
  pages: number;
  steps: ListedStep[];
  ids: Set<string>;
  /** The last step so far: a large item continues on consecutive pages. */
  last: { item: ChatItem; more: boolean; args: string | null } | null;
}
function itemStep(item: ChatItem): ChatStep {
  const step = chatStep(item, 0);
  const more =
    step.clipped || (item.role === "tool" && !!(item.args || item.text));
  return { ...step, parts: more ? 1 : 0 };
}

export class ConversationSteps {
  private readonly indexes = new Map<string, PageIndex>();
  constructor(
    private readonly page: (turnId: string, page: number) => ChatItem,
  ) {}
  list(turn: ChatTurn): { steps: ListedStep[]; stable: number } {
    const settled = !["queued", "running"].includes(turn.status);
    if (!turn.transcript) {
      const steps = turn.items.map((item, index) => ({
        step: itemStep(item),
        source: { kind: "item", index } as const,
      }));
      return { steps, stable: settled ? steps.length : 0 };
    }
    const index = this.index(turn.id, turn.transcript.pages);
    const steps = [
      ...index.steps,
      ...turn.items
        .filter((item) => !index.ids.has(item.id))
        .map((item) => ({
          step: itemStep(item),
          source: { kind: "preview", id: item.id } as const,
        })),
    ];
    return { steps, stable: settled ? steps.length : index.steps.length };
  }
  /** One stored part of a step's full item. */
  detail(turn: ChatTurn, step: number, part: number): ChatItem {
    const listed = this.list(turn).steps[step];
    if (!listed || part >= listed.step.parts) throw new ContractError("stale");
    const source = listed.source;
    if (source.kind === "pages") return this.page(turn.id, source.first + part);
    const item =
      source.kind === "item"
        ? turn.items[source.index]
        : turn.items.find((i) => i.id === source.id);
    if (!item) throw new ContractError("stale");
    return item;
  }
  private index(turnId: string, pages: number): PageIndex {
    let index = this.indexes.get(turnId);
    this.indexes.delete(turnId);
    if (!index || index.pages > pages)
      index = { pages: 0, steps: [], ids: new Set(), last: null };
    for (; index.pages < pages; index.pages++) {
      const fragment = this.page(turnId, index.pages);
      const last = index.last;
      const tail = index.steps.at(-1);
      if (last && tail && last.item.id === fragment.id) {
        const text = last.item.text + fragment.text,
          head = clipText(text, STEP_TEXT_BYTES);
        last.more ||= head.length < text.length;
        last.args =
          last.args !== null &&
          last.args.length + fragment.args.length <= TARGET_ARGS
            ? last.args + fragment.args
            : null;
        last.item = { ...fragment, text: head, args: last.args ?? "" };
        tail.step = chatStep(last.item, tail.step.parts + 1, last.more);
        continue;
      }
      const head = clipText(fragment.text, STEP_TEXT_BYTES);
      index.last = {
        item: { ...fragment, text: head },
        more: head.length < fragment.text.length,
        args: fragment.args,
      };
      index.steps.push({
        step: chatStep(index.last.item, 1, index.last.more),
        source: { kind: "pages", first: index.pages },
      });
      index.ids.add(fragment.id);
    }
    this.indexes.set(turnId, index);
    if (this.indexes.size > INDEXED_TURNS)
      this.indexes.delete(this.indexes.keys().next().value as string);
    return index;
  }
}
