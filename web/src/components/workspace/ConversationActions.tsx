/* Extracted from the pi-web-ui-adapted TaskSidebar. MIT (c) 2026 xing-shuyin.
 * Shared entry points; opening a conversation never sends or starts work. */
import { FiCpu, FiPlus } from "react-icons/fi";
import { useT } from "../../i18n/locale";

export function ConversationActions({
  onConversation,
  onTask,
  disabled = false,
}: {
  onConversation?: () => void;
  onTask?: () => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  return (
    <div className="lp-new">
      <button
        type="button"
        className="new-conversation"
        disabled={disabled}
        onClick={onConversation ?? onTask}
      >
        <FiPlus aria-hidden="true" />
        {onConversation ? t("New conversation") : t("Legacy task")}
      </button>
      {onConversation && onTask && (
        <button
          type="button"
          className="new-task-shortcut"
          aria-label={t("Legacy task")}
          title={t("Legacy task")}
          disabled={disabled}
          onClick={onTask}
        >
          <FiCpu aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
