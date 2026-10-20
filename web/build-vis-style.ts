import { createHash } from "node:crypto";
import type { Plugin } from "vite";
/** Reviewed vis 8.5.4 standalone includes 15 static style-inject calls. Keep their
 * exact CSS literals as a local stylesheet instead of broadening style-src-elem.
 * A different body refuses: no arbitrary JS evaluation or permissive regex fallback. */
export function extractVisStyles(code: string): { code: string; css: string } {
  if (
    createHash("sha256").update(code).digest("hex") !==
    "82ce3dd35a440340e760e06c2a4045e2e72edc65b397f4c6bfc021354d2fe421"
  )
    throw new Error("unreviewed-vis-body");
  const styles: string[] = [];
  const transformed = code.replace(
    /var (css_248z[\w$]*) = ("(?:[^"\\]|\\.)*");\s*styleInject\(\1\);/g,
    (_match, _name: string, literal: string) => {
      const css: unknown = JSON.parse(literal);
      if (typeof css !== "string") throw new Error("vis-style-literal");
      styles.push(css);
      return "";
    },
  );
  if (
    styles.length !== 15 ||
    [...transformed.matchAll(/styleInject\(/g)].length !== 1
  )
    throw new Error("vis-style-closure");
  // The now-unreferenced styleInject function is removed by the real bundler.
  return { code: transformed, css: styles.join("\n") };
}
export function localVisStyles(): Plugin {
  let css: string | undefined;
  return {
    name: "cadence-local-vendor-style",
    apply: "build",
    transform(code, id) {
      if (
        !id
          .replaceAll("\\", "/")
          .endsWith("/vis-timeline/standalone/esm/vis-timeline-graph2d.mjs")
      )
        return;
      const extracted = extractVisStyles(code);
      css = extracted.css;
      return { code: extracted.code, map: null };
    },
    generateBundle() {
      if (css === undefined) throw new Error("vis-styles-unavailable");
      this.emitFile({
        type: "asset",
        fileName: "assets/vis-timeline.css",
        source: css,
      });
    },
    transformIndexHtml: {
      order: "post",
      handler: () => [
        {
          tag: "link",
          attrs: { rel: "stylesheet", href: "/assets/vis-timeline.css" },
          injectTo: "head",
        },
      ],
    },
  };
}
