/* Adapted pi-web-ui Vite configuration; MIT (c) 2026 xing-shuyin.
 * Fixed local outputs; the builder independently audits names, bodies and closure. */
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localVisStyles } from "./build-vis-style.ts";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  envDir: false,
  plugins: [react(), localVisStyles()],
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
