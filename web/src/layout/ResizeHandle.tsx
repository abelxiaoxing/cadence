/* Adapted from pi-web-ui App/RightPanel sash controls; Cadence owns the shared
 * center-space budget and the pointer/keyboard width bounds.
 * MIT (c) 2026 xing-shuyin. Pointer and keyboard change display geometry only. */
import { useEffect, useRef } from "react";
import { useT } from "../i18n/locale";
import { PANEL_MIN, panelWidth } from "./workspace-layout";
export function ResizeHandle({
  side,
  width,
  onResize,
  maximum,
}: {
  side: "left" | "right";
  width: number;
  maximum: number;
  onResize: (w: number) => void;
}) {
  const { t } = useT();
  const dispose = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => dispose.current?.(), []);
  return (
    <input
      type="range"
      min={PANEL_MIN}
      max={maximum}
      step={1}
      value={width}
      onChange={(e) => onResize(panelWidth(Number(e.target.value), maximum))}
      className="resize-handle"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label={t(side === "left" ? "Resize left pane" : "Resize right pane")}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={maximum}
      aria-valuenow={width}
      onDoubleClick={() =>
        onResize(panelWidth(side === "left" ? 260 : 360, maximum))
      }
      onPointerDown={(e) => {
        e.preventDefault();
        dispose.current?.();
        const start = e.clientX;
        const move = (event: PointerEvent) => {
          const delta = (event.clientX - start) * (side === "left" ? 1 : -1);
          onResize(panelWidth(width + delta, maximum));
        };
        const stop = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
          window.removeEventListener("pointercancel", stop);
          dispose.current = undefined;
        };
        dispose.current = stop;
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop, { once: true });
        window.addEventListener("pointercancel", stop, { once: true });
      }}
    />
  );
}
