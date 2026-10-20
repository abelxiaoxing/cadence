/* Adapted from pi-web-ui Dialog.tsx confirm/input/select presentation.
 * MIT (c) 2026 xing-shuyin. Native dialog replaces extension response/appSend. */
import { type ReactNode, useEffect, useId, useRef } from "react";
export function ActionDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
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
        previous.focus();
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
          aria-label="Close dialog — no cancellation of accepted work"
          onClick={onClose}
        >
          Close
        </button>
      </header>
      {children}
    </dialog>
  );
}
