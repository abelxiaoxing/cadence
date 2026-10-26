/* Adapted from pi-web-ui SearchBar.tsx toolbar/keyboard/search navigation and the
 * TopBar host:search chip. MIT (c) 2026 xing-shuyin. Durable search, not DOM-only
 * match discovery. */
import { FiSearch } from "react-icons/fi";
import { useT } from "../../i18n/locale";
export function SearchBar({
  onOpen,
  disabled,
}: {
  onOpen: () => void;
  disabled: boolean;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      className="chip search-toggle"
      aria-label={t("Search all retained pages in selected scope")}
      data-tip={t("Search all retained pages in selected scope")}
      disabled={disabled}
      onClick={onOpen}
    >
      <FiSearch aria-hidden="true" />
    </button>
  );
}
