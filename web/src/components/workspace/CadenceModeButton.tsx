import { FiZap } from "react-icons/fi";
import { useT } from "../../i18n/locale";

export type ModeFacts = { active: boolean; armed: boolean; known: boolean };
export type ComposerMode = "unknown" | "on" | "armed" | "leaving" | "off";
export function composerMode({
  known,
  active,
  armed,
}: ModeFacts): ComposerMode {
  if (!known) return "unknown";
  if (active) return armed ? "on" : "leaving";
  return armed ? "armed" : "off";
}
const labels = {
  unknown: "Cadence state unavailable",
  on: "Turn off Cadence",
  armed: "Turn off Cadence",
  leaving: "Turn on Cadence",
  off: "Turn on Cadence",
} as const;
const titles = {
  unknown: labels.unknown,
  on: "Cadence mode is on. Click to exit on your next message.",
  armed: "Your next message turns on Cadence mode. Click to cancel.",
  leaving:
    "Your next message exits Cadence mode and sends normally. Click to stay in Cadence.",
  off: "Turn on Cadence mode on your next message: agree on a plan before implementation.",
} as const;
const classes = {
  unknown: "unknown",
  on: "on",
  armed: "on armed",
  leaving: "off leaving",
  off: "off",
} as const;
export const modeHints = {
  unknown: labels.unknown,
  on: "Cadence stays on. Confirm one plan before implementation.",
  armed: "Your next message turns on Cadence mode.",
  leaving: "Your next message exits Cadence mode and sends normally.",
  off: null,
} as const;

/** Toggling selects the mode for the next Send without sending immediately. */
export function CadenceModeButton({
  disabled,
  onClick,
  disabledReason,
  ...facts
}: ModeFacts & {
  disabled: boolean;
  disabledReason?: string;
  onClick(): void;
}) {
  const { t } = useT();
  const state = composerMode(facts);
  const label = t(labels[state]);
  return (
    <button
      type="button"
      className={`mode-toggle ${classes[state]}`}
      aria-label={label}
      disabled={disabled || state === "unknown"}
      title={(disabled && disabledReason) || t(titles[state])}
      onClick={onClick}
    >
      <FiZap className="mode-toggle-icon" aria-hidden="true" />
      <span className="mode-switch" aria-hidden="true" />
      {label}
    </button>
  );
}
