/* Adapted pi-web-ui Vite configuration; MIT (c) 2026 xing-shuyin.
 * Fixed local outputs; the builder independently audits names, bodies and closure. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localVisStyles } from "./build-vis-style.ts";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // Worktree development may explicitly reuse installed dependencies via links.
  // Keep the audited logical module IDs; the notice audit still checks every byte.
  resolve: { preserveSymlinks: true },
  publicDir: false,
  envDir: false,
  plugins: [
    tailwindcss(),
    react(),
    localVisStyles(),
    {
      name: "cadence-startup-recovery",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "assets/start.js",
          source: readFileSync(
            new URL("./src/start.js", import.meta.url),
            "utf8",
          ),
        });
        for (const file of [
          "app.webmanifest",
          "icon.svg",
          "icon-192.png",
          "icon-512.png",
          "icon-maskable-512.png",
          "apple-touch-icon.png",
        ]) {
          this.emitFile({
            type: "asset",
            fileName: `assets/${file}`,
            source: readFileSync(new URL(`./src/pwa/${file}`, import.meta.url)),
          });
        }
      },
      transformIndexHtml: {
        order: "post",
        handler: () => [
          {
            tag: "script",
            attrs: { src: "/assets/start.js" },
            injectTo: "head-prepend" as const,
          },
          {
            tag: "link",
            attrs: {
              rel: "manifest",
              href: "/assets/app.webmanifest",
            },
            injectTo: "head" as const,
          },
          {
            tag: "link",
            attrs: {
              rel: "icon",
              type: "image/svg+xml",
              href: "/assets/icon.svg",
            },
            injectTo: "head" as const,
          },
          {
            tag: "link",
            attrs: {
              rel: "apple-touch-icon",
              href: "/assets/apple-touch-icon.png",
            },
            injectTo: "head" as const,
          },
        ],
      },
    },
  ],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/cadence.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith(".css"))
            ? "assets/cadence.css"
            : "assets/[name][extname]",
        advancedChunks: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: "markdown",
              test: /node_modules[\\/](react-markdown|remark-gfm|remark-math|remark-breaks|rehype-katex|rehype-highlight|rehype-raw|rehype-sanitize|katex|highlight\.js)[\\/]/,
            },
            {
              name: "vis-timeline",
              test: /node_modules[\\/]vis-timeline[\\/]/,
            },
          ],
        },
      },
    },
  },
});
