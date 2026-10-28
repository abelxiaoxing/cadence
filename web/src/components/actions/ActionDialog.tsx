/* Adapted from pi-web-ui Dialog.tsx confirm/input/select presentation.
 * MIT (c) 2026 xing-shuyin. Native dialog replaces extension response/appSend. */
import { type ReactNode, useEffect, useId, useRef } from "react";
import { FiX } from "react-icons/fi";
import { useT } from "../../i18n/locale";
export function ActionDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDialogElement>(null),
    id = useId(),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement,
      dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="action-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label={t("Close dialog — no cancellation of accepted work")}
          title={t("Close — accepted work is not cancelled")}
          onClick={onClose}
        >
          <FiX aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
