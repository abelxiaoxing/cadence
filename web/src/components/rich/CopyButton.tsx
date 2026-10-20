/* Adapted from pi-web-ui components/copy-button.tsx; MIT (c) 2026 xing-shuyin. */
import { memo, useState } from "react";
import { FiCheck, FiCopy } from "react-icons/fi";
import { useCopyFeedback } from "../../rich/use-copy-feedback";
export const CopyButton = memo(function CopyButton({ text }: { text: string }) {
  const [failed, setFailed] = useState(false);
  const { copied, copy } = useCopyFeedback();
  return (
    <button
      type="button"
      className="copy-btn"
      title="Copy displayed text"
      aria-label="Copy displayed text"
      onClick={() => {
        setFailed(false);
        void copy(text).then((ok) => setFailed(!ok));
      }}
    >
      {copied ? <FiCheck /> : <FiCopy />}
      {failed && "Copy unavailable"}
    </button>
  );
});
