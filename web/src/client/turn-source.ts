import { useEffect, useState } from "react";
import {
  type ChatStep,
  type ChatTurn,
  chatStep,
} from "../../../src/service/contracts/workbench.ts";
import type { TurnSource } from "./conversation-reader";

/** A turn whose full items are already at hand, such as a workflow subagent's. */
export function recordedTurn(turn: ChatTurn): TurnSource {
  const steps = turn.items.map((item) => ({
    ...chatStep(item, 1),
    text: item.role === "tool" ? "" : item.text,
    clipped: false,
  }));
  return {
    header: {
      id: turn.id,
      epoch: turn.epoch,
      status: turn.status,
      notice: turn.notice,
      omitted: turn.omitted,
      steps: steps.length,
      stable: steps.length,
    },
    steps,
    detail: async (step) => ({
      text: turn.items[step]?.text ?? "",
      args: turn.items[step]?.args ?? "",
    }),
  };
}

/** A step's full recorded item, read only while `wanted`. */
export function useStepDetail(
  turn: TurnSource,
  index: number,
  step: ChatStep,
  wanted: boolean,
): { value?: { text: string; args: string }; error?: string } {
  const key = `${turn.header.id}:${index}:${step.id}:${step.parts}`;
  const [state, setState] = useState<{
    key: string;
    value?: { text: string; args: string };
    error?: string;
  }>({ key: "" });
  const { detail } = turn;
  const parts = step.parts;
  useEffect(() => {
    if (!wanted || parts === 0) return;
    const abort = new AbortController();
    detail(index, parts, abort.signal).then(
      (value) => setState({ key, value }),
      (error: unknown) => {
        if (!abort.signal.aborted)
          setState({
            key,
            error: error instanceof Error ? error.message : "unavailable",
          });
      },
    );
    return () => abort.abort();
  }, [detail, index, parts, wanted, key]);
  return state.key === key ? state : {};
}
