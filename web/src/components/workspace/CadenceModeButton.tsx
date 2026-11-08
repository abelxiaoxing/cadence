import { useT } from "../../i18n/locale";

/** Arming the next Send is not an observed mode change or plan approval. */
export function CadenceModeButton({
  active,
  armed,
  known,
  disabled,
  onClick,
}: {
  active: boolean;
  armed: boolean;
  known: boolean;
  disabled: boolean;
  onClick(): void;
}) {
  const { t } = useT();
  const state = !known ? "unknown" : active ? "on" : armed ? "armed" : "off";
  const label = !known
    ? t("Cadence state unavailable")
    : active
      ? t("Cadence on")
      : armed
        ? t("Cadence on next Send")
        : t("Cadence off");
  return (
    <button
      type="button"
      className={`mode-toggle ${state}`}
      aria-label={label}
      disabled={disabled || !known}
      title={
        active
          ? t("Cadence mode is on. Click to exit it.")
          : armed
            ? t("Your next message turns on Cadence mode. Click to cancel.")
            : t("Turn on Cadence mode: agree on a plan before implementation.")
      }
      onClick={onClick}
    >
      <span className="mode-switch" aria-hidden="true" />
      {label}
    </button>
  );
}
