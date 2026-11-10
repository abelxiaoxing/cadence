/* Adapted from pi-web-ui web/src/components/ImageLightbox.tsx @ b627452c: the
 * floating panel, the viewer and its zoom controls. MIT (c) 2026 xing-shuyin.
 * Cadence: a native modal dialog (the browser contains focus and closes on
 * Escape; focus returns to the opener) over its own object URL of the image's
 * bytes, so the thumbnail may re-read or revoke its URL meanwhile. No OCR,
 * annotation, attach, copy, download, fullscreen or cross-origin loading. */
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  FiMaximize,
  FiMinimize,
  FiX,
  FiZoomIn,
  FiZoomOut,
} from "react-icons/fi";
import { useT } from "../../i18n/locale";

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
/** The next zoom factor after one step, within the viewer's bounds. */
export const zoomStep = (current: number, factor: number) =>
  Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, current * factor));

export function ImageLightbox({
  blob,
  label,
  onClose,
}: {
  blob: Blob;
  /** The image's accessible name, also shown as the panel's title. */
  label: string;
  onClose(): void;
}) {
  const { t } = useT();
  const dialog = useRef<HTMLDialogElement>(null),
    image = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  // Null fits the image to the panel; a number is a factor of its own size.
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    const own = URL.createObjectURL(blob);
    setUrl(own);
    return () => URL.revokeObjectURL(own);
  }, [blob]);
  useEffect(() => {
    const previous = document.activeElement,
      element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  const changeZoom = (factor: number) => {
    if (!size.width) return;
    // From the fitted size on the first step, then from the last factor.
    const fitted = (image.current?.clientWidth || size.width) / size.width;
    setZoom((current) => zoomStep(current ?? fitted, factor));
  };
  const control = (
    name: string,
    icon: ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      type="button"
      className="img-lightbox-btn"
      title={name}
      aria-label={name}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  return (
    <dialog
      ref={dialog}
      className="img-lightbox"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // A press on the dimmed area around the panel closes, like Escape.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        // Escape is the dialog's own cancel; nothing else to handle here.
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <div className="img-lightbox-panel">
        <div className="img-lightbox-toolbar">
          <span className="img-lightbox-name">{label}</span>
          {control(t("Close"), <FiX aria-hidden="true" />, onClose)}
        </div>
        <div
          className={`img-lightbox-image${zoom === null ? "" : " img-lightbox-image-zoomed"}`}
          data-pending={size.width > 0 || failed ? undefined : "true"}
        >
          {url && !failed && (
            <img
              ref={image}
              src={url}
              alt={label}
              style={
                zoom === null || !size.width
                  ? undefined
                  : { width: size.width * zoom, height: size.height * zoom }
              }
              onLoad={(event) =>
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              onError={() => setFailed(true)}
            />
          )}
          {failed && <p role="alert">{t("Image unavailable.")}</p>}
        </div>
        <div className="img-lightbox-view-controls">
          {size.width > 0 && (
            <span className="img-lightbox-dims">
              {size.width} × {size.height}
            </span>
          )}
          {control(
            t("Zoom out"),
            <FiZoomOut aria-hidden="true" />,
            () => changeZoom(1 / 1.25),
            !size.width || (zoom !== null && zoom <= ZOOM_MIN),
          )}
          {control(
            t("Actual size"),
            <FiMaximize aria-hidden="true" />,
            () => setZoom(1),
            !size.width || zoom === 1,
          )}
          {zoom !== null && (
            <span className="img-lightbox-zoom" role="status">
              {Math.round(zoom * 100)}%
            </span>
          )}
          {control(
            t("Zoom in"),
            <FiZoomIn aria-hidden="true" />,
            () => changeZoom(1.25),
            !size.width || (zoom !== null && zoom >= ZOOM_MAX),
          )}
          {control(
            t("Fit to window"),
            <FiMinimize aria-hidden="true" />,
            () => setZoom(null),
            zoom === null,
          )}
        </div>
      </div>
    </dialog>
  );
}
