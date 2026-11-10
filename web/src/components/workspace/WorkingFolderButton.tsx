import { FiFolder } from "react-icons/fi";
import { useT } from "../../i18n/locale";

/** The statusbar's folder chip (pi `status-cwd`): the folder's own name, with
 * the whole path as its hover title. */
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
  const name =
    path
      ?.replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path;
  return (
    <button
      type="button"
      className="status-cwd"
      title={path || t("Choose working folder")}
      aria-label={t("Switch working folder")}
      disabled={disabled}
      onClick={onClick}
    >
      <FiFolder aria-hidden="true" />
      <span>{name || t("Choose working folder")}</span>
    </button>
  );
}
