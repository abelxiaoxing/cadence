import { FiZap } from "react-icons/fi";
import { useT } from "../../i18n/locale";

type ModeFacts = { active: boolean; known: boolean };
export function composerMode({ known, active }: ModeFacts) {
  return !known ? "unknown" : active ? "on" : "off";
}
const labels = {
  unknown: "Cadence state unavailable",
  on: "Turn off Cadence",
  off: "Turn on Cadence",
} as const;
const titles = {
  unknown: labels.unknown,
  on: "Cadence mode is on. Click to exit it.",
  off: "Turn on Cadence mode: agree on a plan before implementation.",
} as const;
export const modeHints = {
  unknown: labels.unknown,
  on: "Cadence stays on. Confirm one plan before implementation.",
  armed: "Your next message turns on Cadence mode.",
  off: null,
} as const;

/** One click switches mode: off enters with a bare /cadence, on exits. */
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
      className={`mode-toggle ${state}`}
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
