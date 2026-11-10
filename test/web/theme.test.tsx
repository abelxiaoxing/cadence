// The colour tokens of both schemes and the theme choice. Contrast is computed
// from the stylesheet sources; no browser renders them here.
// Adapted from pi-web-ui tests/unit/theme-text-contrast.test.ts and
// tests/helpers/theme-contrast.ts @ b627452c; MIT (c) 2026 xing-shuyin.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  chooseTheme,
  currentTheme,
  nextTheme,
  preferredTheme,
  THEME_STORAGE_KEY,
} from "../../web/src/layout/theme";

type Scheme = "light" | "dark";
type Rgba = readonly [number, number, number, number];

const source = (name: string) =>
  readFileSync(new URL(`../../web/src/${name}`, import.meta.url), "utf8");
const SHEETS = ["reference.css", "styles.css"].map(source);
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The `:root { … }` declarations of both sheets, later ones winning. */
function rootTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const css of SHEETS.map(withoutComments))
    for (const block of css.matchAll(/^:root \{\n([\s\S]*?)\n\}/gm))
      for (const declaration of block[1].matchAll(
        /^ {2}(--[a-z0-9-]+):\s*([^;]+);/gm,
      ))
        tokens.set(declaration[1], declaration[2].replace(/\s+/g, " ").trim());
  return tokens;
}
const TOKENS = rootTokens();

function parseColor(value: string): Rgba | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba =
    /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value) ??
    /^rgb\((\d+), (\d+), (\d+)\)$/.exec(value);
  return rgba
    ? [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4] ?? 1)]
    : null;
}
/** A token's colour in one scheme; a single value serves both. */
function color(token: string, scheme: Scheme): Rgba {
  const value = TOKENS.get(token);
  if (value === undefined) throw new Error(`${token} is not defined on :root`);
  const pair = /^light-dark\( ?(.+?), (#[0-9a-f]{6}|rgba?\([^)]*\)) ?\)$/i.exec(
    value,
  );
  const parsed = parseColor(
    pair ? (scheme === "light" ? pair[1] : pair[2]) : value,
  );
  if (!parsed) throw new Error(`${token}: unreadable colour ${value}`);
  return parsed;
}
const over = (top: Rgba, under: Rgba): Rgba => [
  top[0] * top[3] + under[0] * (1 - top[3]),
  top[1] * top[3] + under[1] * (1 - top[3]),
  top[2] * top[3] + under[2] * (1 - top[3]),
  1,
];
function luminance([r, g, b]: Rgba): number {
  const [x, y, z] = [r, g, b]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * x + 0.7152 * y + 0.0722 * z;
}
function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
/** Glyphs, borders and bold headings: WCAG 1.4.11's 3:1. */
const GRAPHIC = 3;
const PAGE = ["--bg", "--bg-elev", "--bg-elev2"];
/** Text tokens on the opaque surfaces they are written on. */
const ON_SURFACES: Readonly<
  Record<string, { min: number; surfaces: string[] }>
> = {
  "--text": { min: AA, surfaces: [...PAGE, "--code-bg", "--notice-info-bg"] },
  "--text-dim": { min: AA, surfaces: PAGE },
  "--text-faint": { min: AA, surfaces: [...PAGE, "--code-bg"] },
  "--accent-text": { min: AA, surfaces: PAGE },
  "--link": { min: AA, surfaces: PAGE },
  "--link-hover": { min: AA, surfaces: PAGE },
  "--link-soft": { min: AA, surfaces: PAGE },
  "--md-strong": { min: AA, surfaces: PAGE },
  "--green": { min: AA, surfaces: PAGE },
  "--red-text": { min: AA, surfaces: [...PAGE, "--notice-err-bg"] },
  "--err-text": { min: AA, surfaces: [...PAGE, "--notice-err-bg"] },
  "--amber-text": { min: AA, surfaces: [...PAGE, "--notice-warn-bg"] },
  "--code-text": { min: AA, surfaces: ["--code-bg"] },
  "--on-accent": { min: AA, surfaces: ["--accent-strong"] },
  "--hl-keyword": { min: AA, surfaces: ["--code-bg"] },
  "--hl-title": { min: AA, surfaces: ["--code-bg"] },
  "--hl-constant": { min: AA, surfaces: ["--code-bg"] },
  "--hl-string": { min: AA, surfaces: ["--code-bg"] },
  "--hl-builtin": { min: AA, surfaces: ["--code-bg"] },
  "--hl-comment": { min: AA, surfaces: ["--code-bg"] },
  "--hl-tag": { min: AA, surfaces: ["--code-bg"] },
  "--hl-bullet": { min: AA, surfaces: ["--code-bg"] },
  "--hl-addition": { min: AA, surfaces: ["--hl-addition-bg"] },
  "--hl-deletion": { min: AA, surfaces: ["--hl-deletion-bg"] },
  "--hl-section": { min: GRAPHIC, surfaces: ["--code-bg"] },
  "--accent": { min: GRAPHIC, surfaces: PAGE },
  "--red": { min: GRAPHIC, surfaces: PAGE },
  "--amber": { min: GRAPHIC, surfaces: PAGE },
  "--info-blue": { min: GRAPHIC, surfaces: PAGE },
};
/** Text on a translucent tint, itself laid over a page surface. */
const ON_TINTS: Readonly<Record<string, { tint: string; text: string[] }>> = {
  accent: {
    tint: "--accent-soft",
    text: ["--text", "--text-dim", "--text-faint", "--accent-text"],
  },
  red: { tint: "--red-soft", text: ["--red-text"] },
  green: { tint: "--green-soft", text: ["--green"] },
};

describe.each(["light", "dark"] as const)("%s scheme", (scheme) => {
  it("keeps every text token readable on the surfaces it is written on", () => {
    const failures: string[] = [];
    for (const [token, { min, surfaces }] of Object.entries(ON_SURFACES))
      for (const surface of surfaces) {
        const ratio = contrast(color(token, scheme), color(surface, scheme));
        if (ratio < min)
          failures.push(`${token} on ${surface}: ${ratio.toFixed(2)} < ${min}`);
      }
    expect(failures).toEqual([]);
  });
  it("keeps text readable on tinted rows, chips and bubbles", () => {
    const failures: string[] = [];
    // A tinted row, chip or bubble lies on the page or on a panel.
    for (const { tint, text } of Object.values(ON_TINTS))
      for (const surface of ["--bg", "--bg-elev"]) {
        const under = over(color(tint, scheme), color(surface, scheme));
        for (const token of text) {
          const ratio = contrast(color(token, scheme), under);
          if (ratio < AA)
            failures.push(
              `${token} on ${tint} over ${surface}: ${ratio.toFixed(2)}`,
            );
        }
      }
    expect(failures).toEqual([]);
  });
});

it("defines each scheme-dependent colour once, as a light-dark() pair", () => {
  // A parser that silently matched nothing would pass every check above.
  expect(TOKENS.size).toBeGreaterThan(100);
  const pairs = [...TOKENS.values()].filter((value) =>
    value.startsWith("light-dark("),
  );
  expect(pairs.length).toBeGreaterThan(90);
  expect(color("--bg", "light")).toEqual([255, 255, 255, 1]);
  expect(color("--bg", "dark")).toEqual([13, 14, 18, 1]);
  // Cadence keeps its violet accent in both schemes.
  expect(TOKENS.get("--accent")).toBe("light-dark(#7c3aed, #8b5cf6)");
  const [reference, styles] = SHEETS;
  expect(styles).toContain("color-scheme: light dark;");
  expect(styles).toMatch(
    /:root\[data-theme="light"\] \{\n {2}color-scheme: light;/,
  );
  expect(styles).toMatch(
    /:root\[data-theme="dark"\] \{\n {2}color-scheme: dark;/,
  );
  expect(reference).not.toContain("color-scheme");
});

it("writes rules against tokens, never a colour of one scheme", () => {
  // Darkening towards black and a ::backdrop fallback are scheme-neutral.
  const neutral = [
    /color-mix\(in srgb, var\(--[a-z-]+\) \d+%, #000\)/g,
    /var\(--scrim, rgba\(0, 0, 0, 0\.5\)\)/g,
  ];
  for (const css of SHEETS) {
    let rules = withoutComments(css).replace(/^:root \{\n[\s\S]*?\n\}/gm, "");
    for (const pattern of neutral) rules = rules.replace(pattern, "");
    expect(rules.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) ?? []).toEqual([]);
  }
});

describe("theme choice", () => {
  afterEach(() => vi.unstubAllGlobals());
  const browser = (saved?: string) => {
    const storage = new Map(saved ? [[THEME_STORAGE_KEY, saved]] : []);
    const dataset: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("document", { documentElement: { dataset } });
    return { storage, dataset };
  };
  it("follows the system until a scheme is explicitly chosen", () => {
    const { storage, dataset } = browser();
    expect(preferredTheme()).toBe("system");
    applyTheme(preferredTheme());
    // No attribute: the stylesheet's own light-dark() follows the system.
    expect(dataset).toEqual({});
    expect(currentTheme()).toBe("system");
    expect(storage.size).toBe(0);
    chooseTheme("light");
    expect(dataset.theme).toBe("light");
    expect(storage.get(THEME_STORAGE_KEY)).toBe("light");
    expect(preferredTheme()).toBe("light");
    expect(currentTheme()).toBe("light");
    chooseTheme("system");
    expect(dataset).toEqual({});
    expect(storage.size).toBe(0);
  });
  it("ignores an unknown saved value and steps system, light, dark", () => {
    browser("sepia");
    expect(preferredTheme()).toBe("system");
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
  it("keeps an applied choice when storage is blocked or absent", () => {
    const dataset: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    vi.stubGlobal("document", { documentElement: { dataset } });
    expect(preferredTheme()).toBe("system");
    chooseTheme("dark");
    expect(currentTheme()).toBe("dark");
    vi.unstubAllGlobals();
    // Server rendering has no document: nothing to apply, nothing thrown.
    expect(currentTheme()).toBe("system");
    expect(() => applyTheme("light")).not.toThrow();
  });
});
