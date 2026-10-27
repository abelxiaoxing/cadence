/* Adapted from pi-web-ui empty-state and PromptTemplates.tsx empty-templates
 * card grid. MIT (c) 2026 xing-shuyin. A card only fills the local draft; it
 * never creates, plans or starts anything. */
import type { IconType } from "react-icons";
import { FiActivity, FiCode, FiSearch } from "react-icons/fi";
import { type MessageKey, useT } from "../../i18n/locale";
import type { TaskKind } from "../../types";

const STARTERS: readonly {
  kind: TaskKind;
  icon: IconType;
  title: MessageKey;
  hint: MessageKey;
  prefix: MessageKey;
}[] = [
  {
    kind: "code",
    icon: FiCode,
    title: "Change code",
    hint: "Edits the checkout after a saved plan and Start",
    prefix: "Implement: ",
  },
  {
    kind: "research",
    icon: FiSearch,
    title: "Readonly research",
    hint: "Reads and reports; never edits files",
    prefix: "Research: ",
  },
  {
    kind: "diagnosis",
    icon: FiActivity,
    title: "Readonly diagnosis",
    hint: "Finds a cause without editing or parent checks",
    prefix: "Diagnose: ",
  },
];
const STEPS: readonly MessageKey[] = [
  "Describe the goal",
  "Write or generate a plan",
  "Confirm Start",
  "Check and review",
];
export function Welcome({
  project,
  onStarter,
}: {
  project: string;
  onStarter: (kind: TaskKind, prefix: string) => void;
}) {
  const { t } = useT();
  return (
    <section className="empty-state welcome">
      <span className="empty-logo" aria-hidden="true">
        C
      </span>
      <h2>
        {project
          ? t("What should Cadence do in {project}?", { project })
          : t("What should Cadence do?")}
      </h2>
      <p>
        {t(
          "Each task is one conversation: its plan, runs, subagents, checks and review stay together in the left sidebar.",
        )}
      </p>
      <ol className="welcome-steps">
        {STEPS.map((step, i) => (
          <li key={step}>
            <span className="welcome-step-num">{i + 1}</span>
            {t(step)}
          </li>
        ))}
      </ol>
      <p className="welcome-note">
        {t(
          "Plans, children, checks and human review share one service owner. No chat or discovery activates execution.",
        )}
      </p>
      <div className="empty-templates">
        <div className="empty-templates-head">
          <span className="empty-templates-title">
            {t("Start from a kind")}
          </span>
          <span className="empty-templates-hint">
            {t("A card only fills the input below.")}
          </span>
        </div>
        <div className="empty-templates-grid">
          {STARTERS.map(({ kind, icon: Icon, title, hint, prefix }) => (
            <button
              type="button"
              key={kind}
              className="empty-template"
              onClick={() => onStarter(kind, t(prefix))}
            >
              <Icon aria-hidden="true" />
              <span className="empty-template-text">
                <span className="empty-template-title">{t(title)}</span>
                <span className="empty-template-hint">{t(hint)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
