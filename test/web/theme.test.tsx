// The glass colour tokens of both schemes and the theme choice. Contrast is
// computed from the stylesheet sources; no browser renders them here.
// Adapted from pi-web-ui tests/unit/theme-text-contrast.test.ts and
// tests/helpers/theme-contrast.ts @ b627452c; MIT (c) 2026 xing-shuyin.
import { readFileSync } from "node:fs";
import { type Container, parse } from "postcss";
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
const SHEETS = [
  "optical-tokens.css",
  "reference.css",
  "styles.css",
  "timeline/timeline.css",
  "optics/ambient.css",
  "components/workspace/design.css",
  "components/rich/reading.css",
].map(source);
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

// Follow declarations of these specific component rules in stylesheet order
// (reference.css is imported before styles.css's local preview overrides).
const selectorKey = (s: string) =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\( | \)/g, (s) => s.trim())
    .replace(/\s*([,>])\s*/g, "$1");
// Keep at-rule ancestry in the key: a base rule and its no-hover override
// are different paint states, even when they have exactly the same selector.
const declarations = new Map<string, string>();
function collectRules(sheet: Container, scope = "") {
  for (const node of sheet.nodes ?? []) {
    if (node.type === "atrule")
      collectRules(node, `${scope}@${node.name} ${node.params} / `);
    if (node.type !== "rule") continue;
    const selectors = new Set([node.selector, ...node.selectors]);
    for (const d of node.nodes)
      if (d.type === "decl")
        for (const selector of selectors)
          declarations.set(
            `${scope}${selectorKey(selector)} { ${d.prop} }`,
            d.value.replace(/\s+/g, " ").trim(),
          );
  }
}
for (const css of SHEETS) collectRules(parse(css));
function declaration(selector: string, property: string): string {
  const key = `${selectorKey(selector)} { ${property} }`;
  const value = declarations.get(key);
  if (value === undefined) throw new Error(`Missing ${key}`);
  return value;
}
function ruleColor(selector: string, property: string, scheme: Scheme): Rgba {
  const value = declaration(selector, property);
  const token = /^var\((--[\w-]+)\)$/.exec(value);
  if (!token) throw new Error(`${selector} { ${property}: ${value} }`);
  return color(token[1], scheme);
}

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
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  if (alias) return color(alias[1], scheme);
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
  "--on-accent": {
    min: AA,
    surfaces: ["--accent-strong", "--brand-grad-a", "--brand-grad-b"],
  },
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
  it("paints a solid sash and two inset split-button focus indicators", () => {
    const sash = ".resize-handle:focus-visible";
    expect(declaration(sash, "border-left")).toBe("2px solid var(--accent)");
    expect(declaration(".resize-handle", "background")).toBe("transparent");
    expect(
      declaration(".composer-split > button:focus-visible", "outline"),
    ).toBe("2px solid currentColor");
    expect(
      declaration(".composer-split > button:focus-visible", "outline-offset"),
    ).toBe("-4px");
    const canvas = ruleColor("body", "background", scheme);
    const composer = over(
      ruleColor(".composer-dock::before", "background", scheme),
      canvas,
    );
    for (const surface of [canvas, composer]) {
      expect(
        contrast(color("--accent", scheme), surface),
      ).toBeGreaterThanOrEqual(GRAPHIC);
    }
    for (const [selector, surface] of [
      [".composer-split > button", composer],
      [
        ".composer-split > .composer-steer",
        ruleColor(".composer-split > .composer-steer", "background", scheme),
      ],
    ] as const)
      expect(
        contrast(ruleColor(selector, "color", scheme), surface),
      ).toBeGreaterThanOrEqual(GRAPHIC);
  });
  it("marks selected sessions, files, workflow items and the current recent folder independently of keyboard focus", () => {
    const current = '.cwd-recent-list > button[aria-current="true"]';
    const row = `:is(.session-item.active, .file-item.selected, .agent-dock-run > .active, ${current})`;
    const marker = `${row}::before`;
    expect(declaration(row, "position")).toBe("relative");
    expect(declaration(marker, "content")).toBe('""');
    expect(declaration(marker, "inset-block")).toBe("6px");
    expect(declaration(marker, "inset-inline-start")).toBe("2px");
    expect(declaration(marker, "position")).toBe("absolute");
    expect(declaration(marker, "border-inline-start")).toBe(
      "3px solid var(--accent)",
    );
    const wing = over(color("--glass-surface", scheme), color("--bg", scheme));
    for (const surface of [wing, over(color("--accent-soft", scheme), wing)])
      expect(
        contrast(color("--accent", scheme), surface),
      ).toBeGreaterThanOrEqual(GRAPHIC);
    expect(
      declaration(".cwd-recent-list > button:focus-visible", "outline-offset"),
    ).toBe("-2px");
    const dialog = over(
      ruleColor(".action-dialog", "background", scheme),
      over(color("--scrim", scheme), color("--bg", scheme)),
    );
    expect(declaration(".action-dialog > section", "background")).toBe(
      "var(--card-bg, var(--bg-elev))",
    );
    for (const panel of [dialog, over(color("--grain", scheme), dialog)]) {
      const backing = over(color("--card-bg", scheme), panel);
      const selected = over(ruleColor(current, "background", scheme), backing);
      for (const face of [panel, backing, selected])
        expect(
          contrast(color("--accent", scheme), face),
        ).toBeGreaterThanOrEqual(GRAPHIC);
      expect(
        contrast(ruleColor(current, "color", scheme), selected),
      ).toBeGreaterThanOrEqual(AA);
      expect(
        contrast(ruleColor(":where(button)", "color", scheme), backing),
      ).toBeGreaterThanOrEqual(AA);
    }
  });
  it("underlines only the current panel independently of hover and focus", () => {
    const current = '.rp-tab:is([aria-pressed="true"], [aria-current="true"])';
    expect(declaration(`${current}::after`, "border-bottom")).toBe(
      "2px solid var(--accent)",
    );
    expect(declaration(`${current}::after`, "position")).toBe("absolute");
    expect(declaration(".rp-tab:focus-visible", "outline-offset")).toBe("-2px");
    const selected = ruleColor(current, "background", scheme);
    const wing = over(color("--glass-surface", scheme), color("--bg", scheme));
    for (const surface of [
      selected,
      wing,
      ruleColor(
        "@media (min-width: 901px) / .drawer-right .rp-tabs",
        "background",
        scheme,
      ),
    ])
      expect(
        contrast(color("--accent", scheme), surface),
      ).toBeGreaterThanOrEqual(GRAPHIC);
  });
  it("keeps the disabled mode label, model and placeholder readable on the input capsule", () => {
    const disabled = ".mode-toggle:disabled";
    expect(declaration(disabled, "opacity")).toBe("1");
    expect(declaration(".mode-toggle", "background")).toBe("transparent");
    expect(declaration(".model-trigger", "transition")).toBe("none");
    const dock = ".composer-dock";
    const plate = `${dock}::before`;
    expect(declaration(dock, "position")).toBe("relative");
    expect(declaration(plate, "position")).toBe("absolute");
    expect(declaration(plate, "inset")).toBe("0");
    expect(declaration(plate, "clip-path")).toBe(
      `inset(0 round ${declaration(dock, "border-radius")})`,
    );
    expect(declaration(plate, "pointer-events")).toBe("none");
    expect(declaration(plate, "backdrop-filter")).toBe("var(--glass-filter)");
    expect(declaration(dock, "z-index")).toBe("1");
    expect(declaration(plate, "z-index")).toBe("-1");
    for (const selector of [dock, ".chat-composer"]) {
      for (const property of ["clip-path", "overflow", "backdrop-filter"])
        expect(declarations.has(`${selector} { ${property} }`)).toBe(false);
    }
    expect(declaration(dock, "box-shadow")).toContain("var(--glass-shadow)");
    expect(declaration(plate, "background-image")).toBe("var(--grain-image)");
    const capsule = over(
      ruleColor(plate, "background", scheme),
      ruleColor("body", "background", scheme),
    );
    const fallback = ruleColor(
      `@supports not (backdrop-filter: blur(1px)) / ${plate}`,
      "background-color",
      scheme,
    );
    expect(fallback[3]).toBe(1);
    for (const surface of [capsule, fallback].flatMap((base) => [
      base,
      over(color("--grain", scheme), base),
    ])) {
      for (const selector of [
        disabled,
        ".model-trigger",
        ".model-trigger.empty",
        "input::placeholder,textarea::placeholder",
      ])
        expect(
          contrast(ruleColor(selector, "color", scheme), surface),
        ).toBeGreaterThanOrEqual(AA);
    }
  });
  it.each([
    ["touch at rest", "@media (hover: none) / .composer-resize"],
    [
      "only the form hovered",
      ":where(.chat-composer:hover) > .composer-resize",
    ],
    [
      "direct interaction",
      ".composer-resize:hover, .composer-resize:focus-visible, .composer-resize:active",
    ],
  ])(
    "distinguishes the short composer grip on both sides: %s",
    (_, selector) => {
      expect(declaration(".composer-resize", "color")).toBe("transparent");
      const ink = ruleColor(selector, "color", scheme);
      // The centered mark straddles the top edge: shadow on reading canvas
      // above, translucent capsule (possibly a grain fleck) below.
      const canvas = ruleColor("body", "background", scheme);
      const capsule = over(
        ruleColor(".composer-dock::before", "background", scheme),
        canvas,
      );
      for (const surface of [
        canvas,
        over(
          color("--glass-shadow", scheme),
          over(color("--primary-glow", scheme), canvas),
        ),
        capsule,
        over(color("--grain", scheme), capsule),
      ])
        expect(contrast(over(ink, surface), surface)).toBeGreaterThanOrEqual(
          GRAPHIC,
        );
    },
  );
  it("distinguishes an empty Other idea from both its card and its fill before focus", () => {
    const ink = ruleColor(
      ".design-custom input:not(:focus)",
      "border-color",
      scheme,
    );
    const controls = ":where(input, select, textarea)";
    expect(declaration(controls, "border")).toMatch(/^1px solid /);
    const card = over(
      ruleColor(".workflow-plan", "background", scheme),
      ruleColor("body", "background", scheme),
    );
    for (const outside of [card, over(color("--grain", scheme), card)]) {
      const fill = over(ruleColor(controls, "background", scheme), outside);
      for (const side of [outside, fill])
        expect(contrast(ink, side)).toBeGreaterThanOrEqual(GRAPHIC);
    }
    expect(declaration("input:focus-visible", "outline")).toBe(
      "2px solid var(--accent)",
    );
  });
  it("keeps the wing material when either drawer slides over the scrim", () => {
    const wing = ".panel-drawer";
    const fill = ruleColor(wing, "background-color", scheme);
    expect(fill).toEqual(color("--glass-surface", scheme));
    expect(fill[3]).toBeLessThan(1);
    expect(declaration(wing, "border")).toBe("1px solid var(--glass-border)");
    expect(declaration(wing, "border-top-color")).toBe(
      "var(--glass-border-top)",
    );
    expect(declaration(wing, "background-image")).toBe("var(--grain-image)");
    expect(declaration(wing, "background-size")).toBe("var(--grain-size)");
    expect(declaration(wing, "backdrop-filter")).toBe("var(--glass-filter)");
    expect(declaration(wing, "box-shadow")).toContain("var(--shadow-1)");
    // The imported 768px rules include more specific compound selectors. A
    // later shorthand in either compact sheet can erase just part of the tier.
    const compactWing =
      /^@media \(max-width: (?:768|900)px\) \/ \.(?:panel-drawer|drawer-left|drawer-right)\S* \{/;
    for (const key of declarations.keys())
      if (compactWing.test(key))
        expect(key).not.toMatch(
          /\{ (background[^ ]*|backdrop-filter|border[^ ]*|box-shadow) \}$/,
        );
    const fallback = `@supports not (backdrop-filter: blur(1px)) / ${wing}`;
    const solid = ruleColor(fallback, "background-color", scheme);
    expect(solid[3]).toBe(1);
    for (const prop of ["background", "background-image", "background-size"])
      expect(declarations.has(`${fallback} { ${prop} }`)).toBe(false);
    const compact = `@media (max-width: 900px) / ${wing}`;
    for (const role of ["--text-dim", "--text-faint", "--control-fg"])
      expect(declaration(compact, role)).toBe("var(--text-secondary)");
    const ink = ruleColor(compact, "--text-secondary", scheme);
    const scrim = color("--scrim", scheme);
    for (const base of [
      solid,
      ...[0, 255].map((c) => over(fill, over(scrim, [c, c, c, 1]))),
    ]) {
      const face = over(color("--grain", scheme), base);
      expect(contrast(ink, face)).toBeGreaterThanOrEqual(AA);
      expect(contrast(color("--accent", scheme), face)).toBeGreaterThanOrEqual(
        GRAPHIC,
      );
    }
  });
  it.each([
    ".receipt",
    ".run-summary",
    ".scm-file",
    ".card",
    ".rtr",
    ".workflow-card",
    ".toolcall",
    ".thinking",
  ])(
    "%s keeps its lit top, quieter edges and static grain on a card backing",
    (card) => {
      const edge = card === ".rtr" ? "--glass-border" : "--glass-card-border";
      expect(declaration(card, "border-radius")).toMatch(/^1[4-6]px$/);
      expect(declaration(card, "border")).toBe(`1px solid var(${edge})`);
      expect(declaration(card, "border-top-color")).toBe(
        "var(--glass-border-top)",
      );
      expect(color("--glass-border-top", scheme)[3]).toBeGreaterThan(
        color(edge, scheme)[3],
      );
      expect(declaration(card, "background-image")).toBe("var(--grain-image)");
      expect(declaration(card, "background-size")).toBe("var(--grain-size)");
      expect(declaration(card, "backdrop-filter")).toBe("var(--card-filter)");
      expect(declaration(card, "box-shadow")).toContain(
        card === ".rtr" ? "var(--glass-shadow)" : "var(--glass-card-shadow)",
      );
      expect(declaration(card, "background-color")).toBe(
        "var(--card-bg, var(--bg-elev))",
      );
      const fallback = `@supports not (backdrop-filter: blur(1px)) / ${card}`;
      expect(ruleColor(fallback, "background-color", scheme)[3]).toBe(1);
      for (const prop of ["background", "background-image", "background-size"])
        expect(declarations.has(`${fallback} { ${prop} }`)).toBe(false);
      if (card === ".receipt")
        expect(declaration(card, "border-left")).toBe(
          "3px solid var(--accent)",
        );
    },
  );
  it("leaves the keyboard target above its card's filter plate without resetting the fill or grain", () => {
    const scope = "@supports (backdrop-filter: blur(1px)) / ";
    const card = `${scope}.msg-body > :is(.toolcall, .thinking):focus-within`;
    expect(
      declaration(
        `${scope}.msg-body:has(> :is(.toolcall, .thinking):focus-within)`,
        "isolation",
      ),
    ).toBe("isolate");
    expect(declaration(card, "position")).toBe("relative");
    expect(declaration(card, "backdrop-filter")).toBe("none");
    const plate = `${card}::before`;
    expect(declaration(plate, "inset")).toBe("0");
    expect(declaration(plate, "z-index")).toBe("-1");
    expect(declaration(plate, "pointer-events")).toBe("none");
    expect(declaration(plate, "backdrop-filter")).toBe("var(--card-filter)");
  });
  it.each([".scm-file:hover", ".scm-file.active"])(
    "%s changes only the fill and preserves the file selection marker",
    (state) => {
      for (const prop of ["background", "background-image", "background-size"])
        expect(declarations.has(`${state} { ${prop} }`)).toBe(false);
      const fill = ruleColor(state, "background-color", scheme);
      expect(fill[3]).toBe(1);
      expect(fill).not.toEqual(
        ruleColor(
          "@supports not (backdrop-filter: blur(1px)) / .scm-file",
          "background-color",
          scheme,
        ),
      );
      const marker = ruleColor(".scm-file.active", "border-left-color", scheme);
      for (const surface of [fill, over(color("--grain", scheme), fill)]) {
        expect(contrast(marker, surface)).toBeGreaterThanOrEqual(GRAPHIC);
        expect(
          contrast(color("--text-dim", scheme), surface),
        ).toBeGreaterThanOrEqual(AA);
      }
    },
  );
  it.each([
    ".model-popover",
    ".mention-menu",
    ".view-menu-items",
    ".more-menu-items",
    ".img-lightbox-panel",
  ])("%s uses the raised menu material with an opaque fallback", (panel) => {
    const plate = [".model-popover", ".mention-menu"].includes(panel)
      ? `${panel}::before`
      : panel;
    expect(declaration(panel, "border")).toBe("1px solid var(--glass-border)");
    expect(declaration(panel, "border-top-color")).toBe(
      "var(--glass-border-top)",
    );
    expect(declaration(panel, "box-shadow")).toContain("var(--shadow-3)");
    expect(declaration(plate, "backdrop-filter")).toBe("var(--glass-filter)");
    expect(declaration(plate, "background-image")).toBe("var(--grain-image)");
    expect(declaration(plate, "background-size")).toBe("var(--grain-size)");
    expect(ruleColor(plate, "background", scheme)[3]).toBeGreaterThanOrEqual(
      0.95,
    );
    expect(
      ruleColor(
        `@supports not (backdrop-filter: blur(1px)) / ${plate}`,
        "background",
        scheme,
      )[3],
    ).toBe(1);
  });
  it("keeps the selected view legible and marked without interpolating when focus moves", () => {
    expect(
      declaration(".view-menu-items > button[aria-pressed]", "transition"),
    ).toBe("none");
    const selected = '.view-menu-items button[aria-pressed="true"]';
    expect(declaration(selected, "box-shadow")).toBe(
      "inset 2px 0 var(--accent)",
    );
    const menu = over(
      ruleColor(".view-menu-items", "background", scheme),
      color("--bg", scheme),
    );
    for (const face of [menu, over(color("--grain", scheme), menu)]) {
      const row = over(ruleColor(selected, "background", scheme), face);
      expect(
        contrast(ruleColor(selected, "color", scheme), row),
      ).toBeGreaterThanOrEqual(AA);
      for (const surface of [face, row])
        expect(
          contrast(color("--accent", scheme), surface),
        ).toBeGreaterThanOrEqual(GRAPHIC);
    }
  });
  it("keeps the mention hint, names and selection rule distinct on the raised plate", () => {
    const plate = ".mention-menu::before";
    expect(declaration(plate, "pointer-events")).toBe("none");
    expect(declaration(".mention-list", "overflow-y")).toBe("auto");
    const menu = over(
      ruleColor(plate, "background", scheme),
      color("--bg", scheme),
    );
    const hint = ruleColor(".mention-menu-hint", "color", scheme);
    const name = ruleColor(".mention-name", "color", scheme);
    const selected = ".mention-item.active";
    const stroke = ruleColor(selected, "border-left-color", scheme);
    for (const backing of [menu, over(color("--grain", scheme), menu)]) {
      expect(contrast(hint, backing)).toBeGreaterThanOrEqual(AA);
      const row = over(ruleColor(selected, "background", scheme), backing);
      for (const side of [row, backing]) {
        expect(contrast(name, side)).toBeGreaterThanOrEqual(AA);
        expect(contrast(stroke, side)).toBeGreaterThanOrEqual(GRAPHIC);
      }
    }
  });
  it("does not fade the disabled model's label and reason as a group", () => {
    expect(declaration(".model-option:disabled", "opacity")).toBe("1");
    const menu = over(
      ruleColor(".model-popover::before", "background", scheme),
      color("--bg", scheme),
    );
    for (const selector of [".model-option", ".model-option-note"])
      expect(
        contrast(ruleColor(selector, "color", scheme), menu),
      ).toBeGreaterThanOrEqual(AA);
  });
  it("keeps every locked thinking level readable and outlines the pressed level on its menu", () => {
    const pressed = '.model-thinking button[aria-pressed="true"]';
    expect(declaration(".model-thinking button:disabled", "opacity")).toBe("1");
    expect(declaration(":where(button)", "background")).toBe(
      "var(--chip-bg, var(--bg-elev2))",
    );
    const menu = over(
      ruleColor(".model-popover::before", "background", scheme),
      color("--bg", scheme),
    );
    for (const backing of [menu, over(color("--grain", scheme), menu)]) {
      const face = over(ruleColor(pressed, "background", scheme), backing);
      expect(
        contrast(ruleColor(pressed, "color", scheme), face),
      ).toBeGreaterThanOrEqual(AA);
      expect(
        contrast(
          ruleColor(":where(button)", "color", scheme),
          over(color("--chip-bg", scheme), backing),
        ),
      ).toBeGreaterThanOrEqual(AA);
      for (const side of [backing, face])
        expect(
          contrast(ruleColor(pressed, "border-color", scheme), side),
        ).toBeGreaterThanOrEqual(GRAPHIC);
    }
  });
  it("marks the active search option with a solid stroke against the dialog and row", () => {
    expect(declaration(".gs-item", "border-inline-start")).toBe(
      "3px solid transparent",
    );
    const active = '.gs-item[aria-selected="true"]';
    const ink = ruleColor(active, "border-inline-start-color", scheme);
    const menu = over(color("--menu-bg", scheme), color("--bg", scheme));
    for (const surface of [
      menu,
      over(ruleColor(active, "background", scheme), menu),
    ])
      expect(contrast(ink, surface)).toBeGreaterThanOrEqual(GRAPHIC);
  });
  it("keeps the selected artifact number readable after pointer departure", () => {
    const code = ruleColor(".fp-code", "background", scheme);
    const selected = over(
      ruleColor(".fp-line.sel", "background", scheme),
      code,
    );
    const gutter = over(
      ruleColor(".fp-line.sel .fp-num", "background", scheme),
      selected,
    );
    expect(
      contrast(ruleColor(".fp-num", "color", scheme), gutter),
    ).toBeGreaterThanOrEqual(AA);
  });
  it("distinguishes resting question marks and underlined prose links on the reading canvas", () => {
    const link = ":is(.msg-text, .md) a[href]";
    expect(declaration(link, "overflow-wrap")).toBe("anywhere");
    expect(declaration(link, "text-decoration")).toBe("underline");
    const bg = ruleColor("body", "background", scheme);
    const [r, g, b] = color(
      scheme === "dark" ? "--lens-violet" : "--lens-silver",
      scheme,
    );
    for (const surface of [bg, over([r, g, b, 0.08], bg)]) {
      const mark = over(ruleColor(".qn-bar", "background", scheme), surface);
      expect(contrast(mark, surface)).toBeGreaterThanOrEqual(GRAPHIC);
      expect(
        contrast(ruleColor(link, "color", scheme), surface),
      ).toBeGreaterThanOrEqual(AA);
    }
  });
  it("keeps the shared Markdown link readable on plan and preview materials", () => {
    const link = ruleColor(":is(.msg-text, .md) a[href]", "color", scheme);
    const canvas = ruleColor("body", "background", scheme);
    const wing = over(color("--glass-surface", scheme), canvas);
    for (const surface of [wing, over(color("--card-bg", scheme), canvas)])
      expect(contrast(link, surface)).toBeGreaterThanOrEqual(AA);
  });
  it("keeps the shared resting copy stroke visible on message and tool surfaces", () => {
    const rule = /\.chead-copy,\s*\.msg-text-copy \{([^}]+)/.exec(
      source("reference.css"),
    )?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/background: transparent;/);
    const ink = /color: var\((--[\w-]+)\);/.exec(rule ?? "")?.[1];
    if (!ink) throw new Error("Missing shared copy foreground");
    const opacity = Number(/opacity: ([^;]+);/.exec(rule ?? "")?.[1] ?? 1);
    const [r, g, b, alpha] = color(ink, scheme);
    const page = color("--bg", scheme);
    for (const surface of [
      page,
      over(color("--card-bg", scheme), page),
      color("--bg-elev2", scheme),
    ]) {
      expect(
        contrast(over([r, g, b, alpha * opacity], surface), surface),
      ).toBeGreaterThanOrEqual(GRAPHIC);
    }
  });
  it("keeps the requested edit readable from the diff body through each tinted row and changed word", () => {
    for (const [ink, tint, mark] of [
      ["--green", "--green-soft", "--word-add-bg"],
      ["--red-text", "--red-soft", "--word-del-bg"],
    ]) {
      const row = over(color(tint, scheme), color("--bg", scheme));
      const word = over(color(mark, scheme), row);
      expect(word).not.toEqual(row);
      for (const surface of [row, word])
        expect(
          contrast(color(ink, scheme), surface),
          mark,
        ).toBeGreaterThanOrEqual(AA);
    }
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

it.each(["dark", "light"] as const)(
  "%s: nested wing, card, menu, selected options, trace chips and focus",
  (scheme) => {
    const c = (key: string) => color(`--${key}`, scheme);
    // Upper bound on the caustic contribution, including its static lens.
    const [r, g, b] = c(scheme === "dark" ? "lens-violet" : "lens-silver");
    const base = over([r, g, b, 0.1], over(c("grain"), c("bg")));
    const wing = over(c("glass-surface"), base);
    const card = over(c("glass-card-bg"), wing);
    const menu = over(c("menu-solid-bg"), card);
    for (const surface of [
      base,
      wing,
      card,
      menu,
      over(c("accent-soft"), menu),
    ]) {
      for (const name of [
        "text",
        "text-secondary",
        "link",
        "green",
        "red",
        "amber",
      ])
        expect(contrast(c(name), surface), name).toBeGreaterThanOrEqual(AA);
      expect(contrast(c("focus"), surface)).toBeGreaterThanOrEqual(GRAPHIC);
    }
    for (const [name] of TOKENS)
      if (name.startsWith("--tl-"))
        expect(
          contrast(color(name, scheme), c("bg-elev2")),
          name,
        ).toBeGreaterThanOrEqual(AA);
  },
);

it("applies the reading budget to shared Markdown prose, not all controls", () => {
  expect(TOKENS.get("--reading-leading")).toBe("1.65");
  expect(declaration(".md :is(p, li, blockquote, td, th)", "line-height")).toBe(
    "var(--reading-leading)",
  );
});

it("defines each scheme-dependent colour once, as a light-dark() pair", () => {
  // A parser that silently matched nothing would pass every check above.
  expect(TOKENS.size).toBeGreaterThan(100);
  expect(color("--bg", "light")).toEqual([244, 245, 247, 1]);
  expect(color("--bg", "dark")).toEqual([9, 10, 13, 1]);
  expect(color("--glass-surface", "light")).toEqual([255, 255, 255, 0.72]);
  const [styles, reference] = SHEETS;
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
  for (const [index, css] of SHEETS.entries()) {
    const rules =
      index === 0
        ? withoutComments(css).replace(/^:root \{\n[\s\S]*?\n\}/gm, "")
        : withoutComments(css);
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
