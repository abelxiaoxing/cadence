/* Adapted from pi-web-ui web/src/components/ContextMenu.tsx &
 * web/src/context-menu-state.ts: portal positioning with viewport clamping,
 * group-based auto separators, and full keyboard navigation.
 * MIT (c) 2026 xing-shuyin. Simplified for Cadence without plugin slots. */
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export const MENU_MARGIN = 8;

export interface ContextMenuItem {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}

export type ContextMenuRow =
  | { kind: "sep"; key: string }
  | { kind: "item"; key: string; index: number; item: ContextMenuItem };

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Keep the floating menu inside the viewport with `MENU_MARGIN` padding. */
export function clampMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const w = Math.max(0, finite(width));
  const h = Math.max(0, finite(height));
  const maxX = Math.max(MENU_MARGIN, finite(viewportWidth) - w - MENU_MARGIN);
  const maxY = Math.max(MENU_MARGIN, finite(viewportHeight) - h - MENU_MARGIN);
  return {
    x: Math.min(Math.max(MENU_MARGIN, finite(x)), maxX),
    y: Math.min(Math.max(MENU_MARGIN, finite(y)), maxY),
  };
}

/** Insert separators automatically between distinct groups, never leading,
 * trailing, or duplicated. */
export function contextMenuRows(
  items: readonly ContextMenuItem[],
): ContextMenuRow[] {
  const rows: ContextMenuRow[] = [];
  let prevGroup: string | null = null;
  items.forEach((item, index) => {
    if (prevGroup !== null && item.group !== prevGroup) {
      rows.push({ kind: "sep", key: `sep:${index}` });
    }
    rows.push({ kind: "item", key: item.id, index, item });
    prevGroup = item.group;
  });
  return rows;
}

export function nextEnabledIndex(
  items: readonly ContextMenuItem[],
  current: number,
  delta: number,
): number {
  const n = items.length;
  if (n === 0) return -1;
  const step = delta >= 0 ? 1 : -1;
  let i = Number.isFinite(current) ? Math.trunc(current) : -1;
  if (i < 0 || i >= n) i = step > 0 ? -1 : n;
  for (let k = 0; k < n; k++) {
    i = (i + step + n) % n;
    if (!items[i]?.disabled) return i;
  }
  return -1;
}

export function ContextMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  items: readonly ContextMenuItem[];
  onClose(): void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const itemsRef = useRef(items);
  const closeRef = useRef(onClose);
  itemsRef.current = items;
  closeRef.current = onClose;

  const rows = useMemo(() => contextMenuRows(items), [items]);

  const setActiveIndex = useCallback((index: number) => {
    activeRef.current = index;
    setActive(index);
  }, []);

  useEffect(() => {
    const first = nextEnabledIndex(items, -1, 1);
    activeRef.current = first;
    setActive(first);
    rootRef.current?.focus({ preventScroll: true });
  }, [items]);

  const rowCount = rows.length;
  useLayoutEffect(() => {
    void rowCount;
    void label;
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(
      clampMenuPosition(
        x,
        y,
        rect.width,
        rect.height,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, [x, y, rowCount, label]);

  useEffect(() => {
    const inside = (target: EventTarget | null) =>
      rootRef.current &&
      target instanceof Node &&
      rootRef.current.contains(target);
    const onDown = (event: MouseEvent) => {
      if (inside(event.target)) return;
      closeRef.current();
    };
    const onWheel = (event: WheelEvent) => {
      if (inside(event.target)) return;
      closeRef.current();
    };
    const onResize = () => closeRef.current();
    const onBlur = () => closeRef.current();
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("wheel", onWheel, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const list = itemsRef.current;
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          closeRef.current();
          return;
        case "Tab":
          closeRef.current();
          return;
        case "ArrowDown":
          event.preventDefault();
          setActiveIndex(nextEnabledIndex(list, activeRef.current, 1));
          return;
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex(nextEnabledIndex(list, activeRef.current, -1));
          return;
        case "Home":
          event.preventDefault();
          setActiveIndex(nextEnabledIndex(list, -1, 1));
          return;
        case "End":
          event.preventDefault();
          setActiveIndex(nextEnabledIndex(list, list.length, -1));
          return;
        case "Enter":
        case " ": {
          event.preventDefault();
          const chosen = list[activeRef.current];
          if (chosen && !chosen.disabled) {
            closeRef.current();
            chosen.onSelect();
          }
          return;
        }
        default:
          return;
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [setActiveIndex]);

  if (typeof document === "undefined" || items.length === 0) return null;

  return createPortal(
    <div
      ref={rootRef}
      className="ctx-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{
        left: pos?.x ?? x,
        top: pos?.y ?? y,
        visibility: pos ? "visible" : "hidden",
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {rows.map((row) =>
        row.kind === "sep" ? (
          <hr key={row.key} className="ctx-menu-sep" />
        ) : (
          <button
            key={row.key}
            type="button"
            role="menuitem"
            className={`ctx-menu-item${row.item.danger ? " danger" : ""}${row.item.disabled ? " disabled" : ""}${active === row.index ? " active" : ""}`}
            aria-disabled={row.item.disabled || undefined}
            data-ctx-active={active === row.index ? "true" : undefined}
            onMouseEnter={() => {
              if (!row.item.disabled) setActiveIndex(row.index);
            }}
            onClick={() => {
              if (row.item.disabled) return;
              onClose();
              row.item.onSelect();
            }}
          >
            {row.item.icon ? (
              <span className="ctx-menu-icon" aria-hidden="true">
                {row.item.icon}
              </span>
            ) : null}
            <span className="ctx-menu-label">{row.item.label}</span>
            {row.item.shortcut ? (
              <span className="ctx-menu-shortcut" aria-hidden="true">
                {row.item.shortcut}
              </span>
            ) : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
