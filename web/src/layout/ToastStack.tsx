/* Adapted from pi-web-ui web/src/App.tsx NoticeToast and its `.notices` stack
 * @ b627452c; MIT (c) 2026 xing-shuyin.
 * Cadence: rendered once by the shell over the browser-local toast store. An
 * error is an alert that stays until dismissed; the others pause while hovered
 * or focused. No click-anywhere dismissal, plugin notice or action slot. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { FiAlertCircle, FiAlertTriangle, FiInfo, FiX } from "react-icons/fi";
import { useT } from "../i18n/locale";
import {
  currentToasts,
  dismissToast,
  subscribeToasts,
  type Toast,
  toastDurationMs,
} from "./toasts";

const NONE: readonly Toast[] = [];
const ICONS = {
  error: FiAlertCircle,
  warning: FiAlertTriangle,
  info: FiInfo,
} as const;

function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useT();
  const [hovered, setHovered] = useState(false),
    [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const duration = toastDurationMs(toast.level);
  useEffect(() => {
    if (paused || duration === null) return;
    const timer = setTimeout(() => dismissToast(toast.id), duration);
    return () => clearTimeout(timer);
  }, [paused, duration, toast.id]);
  const Icon = ICONS[toast.level];
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hovering or focusing only pauses the timer; dismissal is the button inside
    <div
      className={`notice notice-${toast.level}${paused ? " paused" : ""}`}
      role={toast.level === "error" ? "alert" : "status"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <Icon className="notice-icon" aria-hidden="true" />
      <span className="notice-text">{toast.text}</span>
      <button
        type="button"
        className="notice-close"
        title={t("Dismiss notification")}
        aria-label={t("Dismiss notification")}
        onClick={() => dismissToast(toast.id)}
      >
        <FiX aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastStack() {
  const toasts = useSyncExternalStore(
    subscribeToasts,
    currentToasts,
    () => NONE,
  );
  return (
    <div className="notices">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
