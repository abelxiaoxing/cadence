import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatStep } from "../../../../src/service/contracts/workbench.ts";
import {
  stepIdentity,
  type TurnSource,
} from "../../client/conversation-reader";

// Keep the retained workflow projection shared with other readonly callers.
export { recordedTurn } from "../../client/turn-source";

/** Only an explicit event says a block is still being written. Old history
 * without this metadata stays readable, but is not turned into a live event. */
export function stepActive(step: ChatStep): boolean {
  return (
    step.state === "pending" ||
    step.state === "streaming" ||
    step.state === "running"
  );
}

/** A step's full recorded item, read only while wanted. Coordinates choose the
 * data; identity preserves the displayed value while its next revision loads. */
export function useStepDetail(
  turn: TurnSource,
  index: number,
  step: ChatStep,
  wanted: boolean,
): { value?: { text: string; args: string }; error?: string } {
  const identity = `${turn.renderId ?? turn.header.id}:${stepIdentity(step)}`;
  const revision = JSON.stringify([
    index,
    step.parts,
    step.version,
    step.state,
    step.error,
    turn.header.status,
  ]);
  const { detail } = turn;
  const scope = useMemo(
    () => ({ identity, revision, detail, wanted }),
    [identity, revision, detail, wanted],
  );
  const latest = useRef(scope);
  latest.current = scope;
  const [state, setState] = useState<{
    identity: string;
    value?: { text: string; args: string };
    error?: string;
  }>();
  const parts = step.parts;
  useEffect(() => {
    if (!wanted || parts === 0) return;
    const abort = new AbortController();
    const current = () => !abort.signal.aborted && latest.current === scope;
    void detail(index, parts, abort.signal).then(
      (value) => {
        if (current()) setState({ identity, value });
      },
      (error: unknown) => {
        if (current())
          setState((prior) => ({
            identity,
            ...(prior?.identity === identity ? { value: prior.value } : {}),
            error: error instanceof Error ? error.message : "unavailable",
          }));
      },
    );
    return () => abort.abort();
  }, [scope, detail, index, parts, wanted, identity]);
  return wanted && parts > 0 && state?.identity === identity ? state : {};
}
