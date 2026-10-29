import { FiChevronDown, FiFolder } from "react-icons/fi";
import { useT } from "../../i18n/locale";

export function WorkingFolderButton({
  path,
  disabled = false,
  onClick,
}: {
  path?: string;
  disabled?: boolean;
  onClick(): void;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      className="status-cwd"
      title={path || t("Open working folder")}
      aria-label={t("Switch working folder")}
      disabled={disabled}
      onClick={onClick}
    >
      <FiFolder aria-hidden="true" />
      <span>{path || t("Open working folder")}</span>
      <FiChevronDown aria-hidden="true" />
    </button>
  );
}
