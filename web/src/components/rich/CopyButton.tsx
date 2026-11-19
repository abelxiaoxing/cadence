/* Adapted from pi-web-ui components/copy-button.tsx; MIT (c) 2026 xing-shuyin. */
import { memo } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { useT } from "../../i18n/locale";
import { notify } from "../../layout/toasts";
import { useCopyFeedback } from "../../rich/use-copy-feedback";
export const CopyButton = memo(function CopyButton({
  text,
  label,
  className = "copy-btn",
}: {
  text: string;
  label?: string;
  /** The pi button family it belongs to: a code block, a card head or a message. */
  className?: string;
}) {
  const { t } = useT();
  const { copied, copy } = useCopyFeedback();
  return (
    <button
      type="button"
      className={copied ? `${className} copied` : className}
      title={label ?? t("Copy displayed text")}
      aria-label={label ?? t("Copy displayed text")}
      onClick={() => {
        // The check glyph is the success; only a failure needs words.
        void copy(text).then((ok) => {
          if (!ok) notify("error", t("Copy unavailable"));
        });
      }}
    >
      {copied ? <FiCheck /> : <FiCopy />}
    </button>
  );
});
