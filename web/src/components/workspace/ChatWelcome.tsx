/* Extracted from the pi-web-ui-adapted ChatWorkspace. MIT (c) 2026 xing-shuyin.
 * Presentation only, shared by the project-less shell and an empty conversation. */
import type { ReactNode } from "react";
import { useT } from "../../i18n/locale";

export function ChatWelcome({
  hint,
  children,
}: {
  hint: string;
  children?: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="empty-state chat-welcome">
      <span className="empty-logo" aria-hidden="true">
        C
      </span>
      <h2>{t("What would you like to work on?")}</h2>
      <p>{hint}</p>
      {children}
    </div>
  );
}
