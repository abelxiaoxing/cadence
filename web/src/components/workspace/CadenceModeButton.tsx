import { useT } from "../../i18n/locale";

type ModeFacts = { active: boolean; armed: boolean; known: boolean };
export function composerMode({ known, active, armed }: ModeFacts) {
  return !known ? "unknown" : active ? "on" : armed ? "armed" : "off";
}
const labels = {
  unknown: "Cadence state unavailable",
  on: "Cadence on",
  armed: "Cadence on next Send",
  off: "Cadence off",
} as const;
const titles = {
  unknown: labels.unknown,
  on: "Cadence mode is on. Click to exit it.",
  armed: "Your next message turns on Cadence mode. Click to cancel.",
  off: "Turn on Cadence mode: agree on a plan before implementation.",
} as const;
export const modeHints = {
  unknown: labels.unknown,
  on: "Cadence stays on. Confirm one plan before implementation.",
  armed: "Your next message turns on Cadence mode.",
  off: null,
} as const;

/** Arming the next Send is not an observed mode change or plan approval. */
export function CadenceModeButton({
  disabled,
  onClick,
  ...facts
}: ModeFacts & { disabled: boolean; onClick(): void }) {
  const { t } = useT();
  const state = composerMode(facts);
  const label = t(labels[state]);
  return (
    <button
      type="button"
      className={`mode-toggle ${state}`}
      aria-label={label}
      disabled={disabled || state === "unknown"}
      title={t(titles[state])}
      onClick={onClick}
    >
      <span className="mode-switch" aria-hidden="true" />
      {label}
    </button>
  );
}
