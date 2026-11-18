/* Extracted from the pi-web-ui-adapted ChatWorkspace. MIT (c) 2026 xing-shuyin.
 * Presentation only, shared by folder setup and an empty conversation. */
import type { ReactNode } from "react";
import { useT } from "../../i18n/locale";
import { useHeroScene } from "../../optics/AmbientShader";
import { Crystal } from "../../optics/Crystal";

export function ChatWelcome({
  visible = true,
  hint,
  children,
}: {
  visible?: boolean;
  hint: string;
  children?: ReactNode;
}) {
  const mark = useHeroScene(visible);
  const { t } = useT();
  return (
    <div className="empty-state chat-welcome">
      <span ref={mark} className="empty-logo" aria-hidden="true">
        <Crystal />
      </span>
      <h2>{t("What would you like to work on?")}</h2>
      <p>{hint}</p>
      {children}
    </div>
  );
}
