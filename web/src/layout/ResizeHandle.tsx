/* Adapted from pi-web-ui App/RightPanel sizing and panel-sash.ts weight model.
 * MIT (c) 2026 xing-shuyin. Pointer and keyboard change display geometry only. */
import { useEffect, useRef } from "react";
import { applySashDrag } from "./panel-sash";
export function ResizeHandle({
  side,
  width,
  onResize,
}: {
  side: "left" | "right";
  width: number;
  onResize: (w: number) => void;
}) {
  const dispose = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => dispose.current?.(), []);
  return (
    <input
      type="range"
      min={220}
      max={600}
      step={20}
      value={width}
      onChange={(e) => onResize(Number(e.target.value))}
      className="resize-handle"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`Resize ${side} pane`}
      aria-valuemin={220}
      aria-valuemax={600}
      aria-valuenow={width}
      onDoubleClick={() => onResize(side === "left" ? 260 : 360)}
      onPointerDown={(e) => {
        e.preventDefault();
        dispose.current?.();
        const start = e.clientX,
          available = window.innerWidth;
        const move = (event: PointerEvent) => {
          const pair = applySashDrag({
            start: { above: width, below: Math.max(1, available - width) },
            deltaPx: (event.clientX - start) * (side === "left" ? 1 : -1),
            availablePx: available,
            totalWeight: available,
            minAbovePx: 220,
            minBelowPx: 320,
          });
          onResize(Math.min(600, pair.above));
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
