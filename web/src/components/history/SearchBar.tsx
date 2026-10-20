/* Adapted from pi-web-ui SearchBar.tsx toolbar/keyboard/search navigation.
 * MIT (c) 2026 xing-shuyin. Durable search, not DOM-only match discovery. */
import { FiSearch } from "react-icons/fi";
export function SearchBar({
  onOpen,
  disabled,
}: {
  onOpen: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      className="search-toggle"
      disabled={disabled}
      onClick={onOpen}
    >
      <FiSearch /> Search all retained pages in selected scope
    </button>
  );
}
