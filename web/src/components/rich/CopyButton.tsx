/* Adapted from pi-web-ui components/copy-button.tsx; MIT (c) 2026 xing-shuyin. */
import { memo, useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { useT } from "../../i18n/locale";
import { useCopyFeedback } from "../../rich/use-copy-feedback";
export const CopyButton = memo(function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const [failed, setFailed] = useState(false);
  const { copied, copy } = useCopyFeedback();
  return (
    <button
      type="button"
      className="copy-btn"
      title={t("Copy displayed text")}
      aria-label={t("Copy displayed text")}
      onClick={() => {
        setFailed(false);
        void copy(text).then((ok) => setFailed(!ok));
      }}
    >
      {copied ? <FiCheck /> : <FiCopy />}
      {failed && t("Copy unavailable")}
    </button>
  );
});
