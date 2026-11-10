/* Adapted from pi-web-ui web/src/theme.ts @ b627452c: a saved choice applied as
 * `data-theme` on the root element. MIT (c) 2026 xing-shuyin.
 * Cadence: both schemes are compiled into the one stylesheet as light-dark()
 * tokens, so there is no theme list, stylesheet swap or server read. Without a
 * choice the stylesheet follows the system's scheme by itself. */

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "cadence-theme";
const CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

const forced = (value: unknown): value is "light" | "dark" =>
  value === "light" || value === "dark";

/** A saved explicit choice, else the system's scheme. */
export function preferredTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (forced(saved)) return saved;
  } catch {}
  return "system";
}
/** `data-theme` forces a scheme; without it the stylesheet follows the system. */
export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === "undefined") return;
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}
/** What is applied now: it outlives blocked storage for as long as the page. */
export function currentTheme(): ThemeChoice {
  const applied =
    typeof document === "undefined"
      ? undefined
      : document.documentElement.dataset.theme;
  return forced(applied) ? applied : "system";
}
/** An explicit choice, applied at once and remembered only in this browser. */
export function chooseTheme(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {}
  applyTheme(choice);
}
/** The topbar control steps through system, light and dark. */
export const nextTheme = (choice: ThemeChoice): ThemeChoice =>
  CHOICES[(CHOICES.indexOf(choice) + 1) % CHOICES.length];
