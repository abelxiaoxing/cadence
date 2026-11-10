/* Adapted from pi-web-ui web/src/components/MessageList.tsx @ b627452c: the
 * question navigation rail (`qn-rail`) beside the transcript, one numbered bar
 * per user message. MIT (c) 2026 xing-shuyin.
 * Cadence: the questions come from the session tree read, so the rail also
 * names turns that are not loaded yet; a jump only reads and scrolls. The rail
 * opens on focus as well as hover, its buttons are one arrow-key group, and
 * phones do not show it. No per-message tags, skill blocks or paging. */
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "../../i18n/locale";
import { questionNavLayout } from "../../transcript/question-nav";

export interface RailQuestion {
  id: string;
  text: string;
}

export function QuestionRail({
  questions,
  active,
  reading,
  onJump,
}: {
  questions: readonly RailQuestion[];
  /** The question the transcript is at, -1 when none. */
  active: number;
  /** The question whose turn is being read for a jump. */
  reading: string | null;
  onJump(id: string): void;
}) {
  const { t } = useT();
  const rail = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = rail.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const { indices, gap, many } = useMemo(
    () => questionNavLayout(questions.length, height, active),
    [questions.length, height, active],
  );
  // One tab stop for the whole rail: the bar of the question the transcript
  // is at. The arrow keys walk the bars, or the full list once focus opened it.
  const tabbable = indices.includes(active) ? active : indices.at(-1);
  const walk = (event: KeyboardEvent<HTMLElement>) => {
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        many ? ".qn-list-item" : ".qn-bar",
      ),
    ];
    if (!buttons.length) return;
    event.preventDefault();
    const focused = document.activeElement as HTMLElement | null;
    const at = many
      ? Number(focused?.dataset.question ?? 0)
      : buttons.indexOf(focused as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : Math.min(buttons.length - 1, Math.max(0, at + step));
    buttons[next]?.focus();
  };
  // The full list opens on hover or focus: at the question being read.
  const revealActive = () =>
    rail.current
      ?.querySelector(".qn-list-item.active")
      ?.scrollIntoView({ block: "nearest" });
  // A pointer's click must not leave the rail open behind it; the keyboard
  // (a click with no pointer detail) keeps its place.
  const jump = (event: MouseEvent<HTMLButtonElement>, id: string) => {
    if (event.detail > 0) event.currentTarget.blur();
    onJump(id);
  };
  const label = (index: number) => `${index + 1}. ${questions[index].text}`;
  return (
    <nav
      className={`qn-rail${many ? " many" : ""}`}
      ref={rail}
      aria-label={t("Questions in this conversation")}
      style={{ "--rail-gap": `${gap}px` } as CSSProperties}
      onKeyDown={walk}
      onMouseEnter={revealActive}
      onFocus={(event) => {
        // Only as focus enters: walking the list must not scroll it back.
        if (!event.currentTarget.contains(event.relatedTarget)) revealActive();
      }}
    >
      {indices.map((index) => {
        const question = questions[index];
        return (
          <button
            type="button"
            key={question.id}
            className={`qn-bar${index === active ? " active" : ""}`}
            aria-label={label(index)}
            aria-current={index === active ? "true" : undefined}
            aria-busy={reading === question.id || undefined}
            data-question={index}
            tabIndex={index === tabbable ? 0 : -1}
            onClick={(event) => jump(event, question.id)}
          >
            <span className="qn-bar-text">{label(index)}</span>
          </button>
        );
      })}
      {many && (
        <div className="qn-list">
          {questions.map((question, index) => (
            <button
              type="button"
              key={question.id}
              className={`qn-list-item${index === active ? " active" : ""}`}
              aria-label={label(index)}
              aria-current={index === active ? "true" : undefined}
              aria-busy={reading === question.id || undefined}
              data-question={index}
              tabIndex={-1}
              onClick={(event) => jump(event, question.id)}
            >
              <span className="qn-list-idx">{index + 1}</span>
              <span className="qn-list-text">{question.text || "…"}</span>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
