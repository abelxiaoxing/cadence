/* Extracted from the pi-web-ui-adapted ChatWorkspace presentation. MIT (c) 2026 xing-shuyin. */
import type { ChatTurn } from "../../../../src/service/contracts/workbench.ts";
import { useT } from "../../i18n/locale";
import { Markdown } from "../rich/Markdown";
import { StreamMarkdown } from "../rich/StreamMarkdown";
import { ChatSteps, LEGACY_OMITTED_NOTICE, turnParts } from "./ChatSteps";
export function ChatTurnView({ turn }: { turn: ChatTurn }) {
  const { t, tx } = useT();
  const { steps, answer } = turnParts(turn.items);
  const live = turn.status === "running" && answer.length === 0;
  const grouped =
    steps.length > 0 || live || Object.values(turn.omitted).some(Boolean);
  const notice = turn.notice
    .split("\n")
    .filter((line) => line && line !== LEGACY_OMITTED_NOTICE);
  return (
    <section className="chat-turn" aria-label={t("Conversation turn")}>
      {turn.items
        .filter((item) => item.role === "user")
        .map((item) => (
          <article className="chat-message user" key={item.id}>
            <div className="chat-message-role">{t("You")}</div>
            <Markdown text={item.text} />
          </article>
        ))}
      {(grouped || answer.length > 0) && (
        <article className="chat-message assistant">
          <div className="chat-message-role">Cadence</div>
          {grouped && (
            <ChatSteps
              turn={turn}
              steps={steps}
              live={live}
              answered={answer.length > 0}
            />
          )}
          {answer.map((item) =>
            turn.status === "running" ? (
              <StreamMarkdown key={item.id} text={item.text} />
            ) : (
              <Markdown key={item.id} text={item.text} />
            ),
          )}
        </article>
      )}
      {notice.length > 0 && (
        <p className="inspector-note chat-turn-notice">
          {notice.map((line) => tx(line)).join("\n")}
        </p>
      )}
      {!["completed", "running", "queued"].includes(turn.status) && (
        <p className={`ep-state ${turn.status}`}>{tx(turn.status)}</p>
      )}
    </section>
  );
}
