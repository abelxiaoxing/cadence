/* Adapted from pi-web-ui LeftPanel. MIT (c) 2026 xing-shuyin.
 * Shared conversation entry. Opening never sends or starts work. */
import { FiPlus } from "react-icons/fi";
import { useT } from "../../i18n/locale";
export function ConversationActions({
  onConversation,
  disabled = false,
}: {
  onConversation?: () => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  return (
    <div className="lp-new">
      <button
        type="button"
        className="new-conversation"
        disabled={disabled || !onConversation}
        onClick={onConversation}
      >
        <FiPlus aria-hidden="true" />
        {t("New conversation")}
      </button>
    </div>
  );
}
