/* Adapted from pi-web-ui web/src/components/ThinkingBlock.tsx @ b627452c: the
 * collapsible `.thinking` block, its head and its plain-text body.
 * MIT (c) 2026 xing-shuyin.
 * Cadence: a listing carries no thinking text, so the block starts folded and
 * reads its text through the step-detail read once opened, like a tool card.
 * No live ticker, preview, flow-mode capsule, tool inspector or marker
 * stripping: the text is shown as recorded. */
import { useState } from "react";
import { FiCpu } from "react-icons/fi";
import type { ChatStep } from "../../../../src/service/contracts/workbench.ts";
import type { TurnSource } from "../../client/conversation-reader";
import { useStepDetail } from "../../client/turn-source";
import { describeError, useT } from "../../i18n/locale";
import { CopyButton } from "../rich/CopyButton";
import { CollapsibleHead } from "../transcript/CollapsibleHead";
import { HalfRingSpinner } from "./ChatSteps";

/** One readable thinking block of a reply, in its recorded place. */
export function ThinkingStep({
  turn,
  index,
  step,
}: {
  turn: TurnSource;
  index: number;
  step: ChatStep;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const detail = useStepDetail(turn, index, step, open);
  const { header } = turn;
  // The owner may still change a step it has not settled; nothing is streamed.
  const recording =
    (header.status === "queued" || header.status === "running") &&
    index >= header.stable;
  const text = detail.value?.text.trim() ?? "";
  const pending = t("Thinking still being recorded");
  return (
    <div className={`thinking${open ? " open" : ""}`}>
      <CollapsibleHead
        open={open}
        onToggle={() => setOpen((shown) => !shown)}
        headClassName="thinking-head"
        titleText={t(open ? "Collapse" : "Show thinking")}
        icon={<FiCpu aria-hidden="true" />}
        iconClassName="thinking-icon"
        titleClassName="thinking-label"
        after={
          <>
            {recording && (
              <span
                className="toolcall-status"
                role="img"
                title={pending}
                aria-label={pending}
              >
                <HalfRingSpinner />
              </span>
            )}
            <span className="toolcall-spacer" />
            {text && <CopyButton text={text} className="chead-copy" />}
          </>
        }
      >
        {t("Thinking")}
      </CollapsibleHead>
      {open && (
        <div className="thinking-body">
          {text || (
            <p className={detail.error ? "banner-notice" : "inspector-note"}>
              {detail.error
                ? describeError(t, detail.error)
                : step.parts === 0 || detail.value
                  ? t("No thinking text is recorded for this block.")
                  : t("Reading…")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
