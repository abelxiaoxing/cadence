import { type TurnSource, unsettled } from "../../client/conversation-reader";
import { type IndexedStep, toolState } from "./ChatSteps";
import { stepActive } from "./turn-source";

interface CompletedTrace {
  members: IndexedStep[];
  count: number;
}

/** A view of one turn's reply. Keep the original keyed, indexed steps: neither
 * membership nor the number in a summary is a new step or read coordinate. */
export function traceGroups(turn: TurnSource, replies: readonly IndexedStep[]) {
  const entries: (IndexedStep | CompletedTrace)[] = [];
  let members: IndexedStep[] = [];
  let count = 0;
  let afterProse = false;
  const flush = () => {
    if (count >= (afterProse ? 2 : 3)) entries.push({ members, count });
    else for (const part of members) entries.push(part);
    members = [];
    count = 0;
  };
  let nextIndex = 0;
  for (const part of replies) {
    // turnParts lists user entries separately. Don't join traces across a
    // second user message, even if a retained transcript shares one header.
    for (; nextIndex < part.index; nextIndex++) {
      if (turn.steps[nextIndex].role === "user") {
        flush();
        afterProse = false;
      }
    }
    nextIndex = part.index + 1;
    const { step } = part;
    if (
      step.role === "thinking" &&
      !step.error &&
      step.parts === 0 &&
      step.state !== "failed" &&
      !(stepActive(step) && unsettled(turn.header.status))
    ) {
      // An inactive body-free observation can travel with its neighbours,
      // but does not contribute a completed step (nor lower the threshold).
      members.push(part);
    } else if (
      (step.role === "tool" && toolState(turn, part.index) === "ok") ||
      (step.role === "thinking" && !step.error && step.state === "completed")
    ) {
      members.push(part);
      count++;
    } else {
      flush();
      entries.push(part);
      if (step.role === "assistant" && !step.error) afterProse = true;
    }
  }
  flush();
  return entries;
}
