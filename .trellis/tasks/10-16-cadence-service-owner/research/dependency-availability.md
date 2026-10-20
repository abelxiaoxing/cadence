# W1 dependency availability — readonly provisioning discovery

## Scope and authority

- Active task command: `python3 ./.trellis/scripts/task.py current --source` → `.trellis/tasks/10-16-cadence-service-owner`; source `session:pi_01a1434b-d5a8-75bd-a752-9b20360b70f8`.
- Read parent `design-clients-distribution.md`, `research/implementation-context.md`, `research/design-ui-distribution.md` and `.trellis/spec/backend/task-distribution-guidelines.md`. The approved exact pins below remain unchanged.
- Inspected public manifests, license bodies and artifact presence only. Node `createRequire(...).resolve` read public manifests without loading packages; no SDK/provider construction. Browser checks were command lookup/`--version` only.
- No installs, downloads, package-management/network calls, lifecycle scripts, product tests, builds, lock updates, service/browser sessions or product/config writes. No user auth/settings/`.env`, browser profiles, npm request indexes/headers or global SDK resolution were read. The sole intended write is this research file.
- Directory-only probes established the two conventional package caches below. For npm, enumerated `content-v2` paths, sniffed gzip magic, then streamed package tar metadata/public manifests/licenses; non-gzip response bodies and all `index-v5` request metadata were left unread. Tarballs were never extracted.
- Discovery is a bounded local snapshot, not proof packages are globally unavailable, installed, complete, trustworthy or runnable. No online fallback or version substitutions are selected.

## Result / blockers

- **14/26 approved direct pins have artifact bodies in the inspected roots; 12 exact pins are missing.** Only `ws@8.21.3` is already directly resolvable at its approved version from this checkout.
- W1 transport prerequisite: `ws@8.21.3` runtime and full MIT body exist in checkout/Bun cache. **`@types/ws@8.18.1` is missing everywhere inspected**; direct manifest/lock-edge provisioning remains separate work. Do not treat existing incidental resolution as the approved direct dependency edge.
- Browser/build/test blockers: missing exact React DOM types/icons, highlighted/HTML rendering packages, KaTeX/font bodies, vis package/embedded notices, Vite/plugin and Playwright listed below. No complete offline web build/test closure is demonstrated.
- Additional notice blockers: exact cached `remark-math@6.0.0` and `rehype-katex@7.0.1` have MIT metadata/README attribution but **no standalone full license body** in either Bun directory or npm tarball.
- An existing standalone Chromium and headless-shell executable are available (version-only evidence below); missing browser executable is **not** the present blocker. Exact `playwright-core@1.63.0` and actual compatibility/runtime qualification remain missing.

Missing exact pins (all inspected package roots):

- `@types/ws@8.18.1`
- `react-icons@5.7.0`
- `@types/react-dom@19.3.0`
- `rehype-highlight@7.0.2`
- `rehype-raw@7.0.0`
- `rehype-sanitize@6.0.0`
- `highlight.js@11.12.0`
- `katex@0.18.7`
- `vis-timeline@8.5.4`
- `vite@8.3.0`
- `@vitejs/plugin-react@6.1.1`
- `playwright-core@1.63.0`

## Roots and notation

- `C` = `/home/mirako/abel/cadence/node_modules` (checkout installed tree; recursive public-manifest inventory plus direct Node resolution).
- `B` = `/home/mirako/.bun/install/cache` (expanded named package-version cache directories only; scoped packages under scope directory).
- `N` = `/home/mirako/.npm/_cacache/content-v2` (npm content-addressed gzip tarballs, not request metadata); `Nxx` resolves to exact content path in the artifact index below.
- `U` = `/home/mirako/abel/pi-web-ui` (known pinned reference checkout; `node_modules`, `web/node_modules` and `web/dist` absent).
- All `C/<name>/package.json` paths reported by direct resolution have the same realpath, not a global/ancestor package fallback. `B/<name>@<version>@@@1/package.json` is the actual cache layout for entries inventoried here.

## Approved direct pin matrix

“Exact sources” is artifact availability, not installed dependency resolution. Versions in the other columns are observations, **not replacement recommendations**.

| Package | Approved | C installed versions | B cached versions | N tarball versions | Exact sources |
| --- | --- | --- | --- | --- | --- |
| `ws` | 8.21.3 | 8.21.3 | 8.21.1, 8.21.3 | 8.21.1 | `B/ws@8.21.3@@@1`, `C/ws` |
| `@types/ws` | 8.18.1 | — | — | — | **MISSING** |
| `react` | 19.3.0 | — | 19.2.5, 19.2.7 | 19.2.5, 19.2.8, 19.3.0 | `N19` |
| `react-dom` | 19.3.0 | — | 19.2.5, 19.2.7 | 19.2.5, 19.2.8, 19.3.0 | `N22` |
| `react-icons` | 5.7.0 | — | — | — | **MISSING** |
| `@types/react` | 19.3.0 | — | 19.2.14, 19.2.17 | 19.2.14, 19.2.18, 19.3.0 | `N05` |
| `@types/react-dom` | 19.3.0 | — | — | — | **MISSING** |
| `react-markdown` | 10.1.0 | — | 10.1.0 | 10.1.0 | `B/react-markdown@10.1.0@@@1`, `N23` |
| `remark-gfm` | 4.0.1 | — | 4.0.1 | 4.0.1 | `B/remark-gfm@4.0.1@@@1`, `N26` |
| `remark-breaks` | 4.0.0 | — | 4.0.0 | 4.0.0 | `B/remark-breaks@4.0.0@@@1`, `N25` |
| `remark-math` | 6.0.0 | — | 6.0.0 | 6.0.0 | `B/remark-math@6.0.0@@@1`, `N27` |
| `rehype-highlight` | 7.0.2 | — | — | — | **MISSING** |
| `rehype-katex` | 7.0.1 | — | 7.0.1 | 7.0.1 | `B/rehype-katex@7.0.1@@@1`, `N24` |
| `rehype-raw` | 7.0.0 | — | — | — | **MISSING** |
| `rehype-sanitize` | 6.0.0 | — | — | — | **MISSING** |
| `highlight.js` | 11.12.0 | 10.7.3 | 10.7.3 | — | **MISSING** |
| `katex` | 0.18.7 | — | 0.16.45 | 0.16.45, 0.16.47 | **MISSING** |
| `unified` | 11.0.5 | — | 11.0.5 | 11.0.5 | `B/unified@11.0.5@@@1`, `N34` |
| `remark-parse` | 11.0.0 | — | 11.0.0 | 11.0.0 | `B/remark-parse@11.0.0@@@1`, `N28` |
| `micromark-util-types` | 2.0.2 | — | 2.0.2 | 2.0.2, 2.0.3 | `B/micromark-util-types@2.0.2@@@1`, `N12` |
| `mdast-util-from-markdown` | 2.0.3 | — | 2.0.3 | 2.0.3, 2.1.0 | `B/mdast-util-from-markdown@2.0.3@@@1`, `N09` |
| `mdast-util-math` | 3.0.0 | — | 3.0.0 | 3.0.0 | `B/mdast-util-math@3.0.0@@@1`, `N11` |
| `vis-timeline` | 8.5.4 | — | — | — | **MISSING** |
| `vite` | 8.3.0 | 8.2.1 | 6.4.2, 6.4.3, 8.2.1 | 6.4.2, 6.4.3, 6.4.4, 8.1.2, 8.1.5, 8.2.1 | **MISSING** |
| `@vitejs/plugin-react` | 6.1.1 | — | 5.2.0 | 5.2.0 | **MISSING** |
| `playwright-core` | 1.63.0 | — | — | 1.57.0, 1.58.2, 1.62.1 | **MISSING** |

## Exact body / entry / license availability

Entries means explicit `main/module/types/typings/bin/exports` file targets from package metadata (wildcard export patterns excluded); presence is not module loading, typechecking or closure verification. For npm, files were inspected inside the tar without extraction. License hashes below bind inspected full body files, not a completed bundled-notice audit.

| Exact artifact | Explicit entry targets | License metadata / body files |
| --- | --- | --- |
| `B/ws@8.21.3@@@1` (`ws@8.21.3`) | 4 targets present | MIT; `LICENSE` (1183 B) |
| `C/ws` (`ws@8.21.3`) | 4 targets present | MIT; `LICENSE` (1183 B) |
| `N19` (`react@19.3.0`) | 8 targets present | MIT; `package/LICENSE` (1088 B) |
| `N22` (`react-dom@19.3.0`) | 17 targets present | MIT; `package/LICENSE` (1088 B) |
| `N05` (`@types/react@19.3.0`) | 12 targets present | MIT; `react/LICENSE` (1141 B) |
| `B/react-markdown@10.1.0@@@1` (`react-markdown@10.1.0`) | 1 targets present | MIT; `license` (1079 B) |
| `N23` (`react-markdown@10.1.0`) | 1 targets present | MIT; `package/license` (1079 B) |
| `B/remark-gfm@4.0.1@@@1` (`remark-gfm@4.0.1`) | 1 targets present | MIT; `license` (1094 B) |
| `N26` (`remark-gfm@4.0.1`) | 1 targets present | MIT; `package/license` (1094 B) |
| `B/remark-breaks@4.0.0@@@1` (`remark-breaks@4.0.0`) | 1 targets present | MIT; `license` (1099 B) |
| `N25` (`remark-breaks@4.0.0`) | 1 targets present | MIT; `package/license` (1099 B) |
| `B/remark-math@6.0.0@@@1` (`remark-math@6.0.0`) | 1 targets present | MIT; **no license body file** |
| `N27` (`remark-math@6.0.0`) | 1 targets present | MIT; **no license body file** |
| `B/rehype-katex@7.0.1@@@1` (`rehype-katex@7.0.1`) | 1 targets present | MIT; **no license body file** |
| `N24` (`rehype-katex@7.0.1`) | 1 targets present | MIT; **no license body file** |
| `B/unified@11.0.5@@@1` (`unified@11.0.5`) | 1 targets present | MIT; `license` (1099 B) |
| `N34` (`unified@11.0.5`) | 1 targets present | MIT; `package/license` (1099 B) |
| `B/remark-parse@11.0.0@@@1` (`remark-parse@11.0.0`) | 1 targets present | MIT; `license` (1099 B) |
| `N28` (`remark-parse@11.0.0`) | 1 targets present | MIT; `package/license` (1099 B) |
| `B/micromark-util-types@2.0.2@@@1` (`micromark-util-types@2.0.2`) | 1 targets present | MIT; `license` (1094 B) |
| `N12` (`micromark-util-types@2.0.2`) | 1 targets present | MIT; `package/license` (1094 B) |
| `B/mdast-util-from-markdown@2.0.3@@@1` (`mdast-util-from-markdown@2.0.3`) | 2 targets present | MIT; `license` (1094 B) |
| `N09` (`mdast-util-from-markdown@2.0.3`) | 2 targets present | MIT; `package/license` (1094 B) |
| `B/mdast-util-math@3.0.0@@@1` (`mdast-util-math@3.0.0`) | 1 targets present | MIT; `license` (1099 B) |
| `N11` (`mdast-util-math@3.0.0`) | 1 targets present | MIT; `package/license` (1099 B) |

### License body SHA-256

| Artifact | Body | SHA-256 |
| --- | --- | --- |
| `B/ws@8.21.3@@@1` | `LICENSE` | `2b29dcfe0d6471f7e8c92c5fb38c9f93edee10330937055440192f1832b1ecef` |
| `C/ws` | `LICENSE` | `2b29dcfe0d6471f7e8c92c5fb38c9f93edee10330937055440192f1832b1ecef` |
| `N19` | `package/LICENSE` | `da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93` |
| `N22` | `package/LICENSE` | `da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93` |
| `N05` | `react/LICENSE` | `c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383` |
| `B/react-markdown@10.1.0@@@1` | `license` | `f6196c64e144f9a6fa9154c3a80bc8b89615a9567934b83a8951879f06ba2aef` |
| `N23` | `package/license` | `f6196c64e144f9a6fa9154c3a80bc8b89615a9567934b83a8951879f06ba2aef` |
| `B/remark-gfm@4.0.1@@@1` | `license` | `dd1081884a92952802f4803110a6bb543acea9a814c786d58605b4c1219b5ebb` |
| `N26` | `package/license` | `dd1081884a92952802f4803110a6bb543acea9a814c786d58605b4c1219b5ebb` |
| `B/remark-breaks@4.0.0@@@1` | `license` | `d8fc337aaf98fc7a0f5498edc18b47a9df8cdfcc1a0f013519105905722c7a4c` |
| `N25` | `package/license` | `d8fc337aaf98fc7a0f5498edc18b47a9df8cdfcc1a0f013519105905722c7a4c` |
| `B/unified@11.0.5@@@1` | `license` | `05811400116ed61f1a7693b78fe8ca6598c155a12f3978e609db4df648a4cb3d` |
| `N34` | `package/license` | `05811400116ed61f1a7693b78fe8ca6598c155a12f3978e609db4df648a4cb3d` |
| `B/remark-parse@11.0.0@@@1` | `license` | `413654b0a78b98661dce96d2aff2e4d075603d220b8483e28b1aa010ccc138b4` |
| `N28` | `package/license` | `413654b0a78b98661dce96d2aff2e4d075603d220b8483e28b1aa010ccc138b4` |
| `B/micromark-util-types@2.0.2@@@1` | `license` | `dd1081884a92952802f4803110a6bb543acea9a814c786d58605b4c1219b5ebb` |
| `N12` | `package/license` | `dd1081884a92952802f4803110a6bb543acea9a814c786d58605b4c1219b5ebb` |
| `B/mdast-util-from-markdown@2.0.3@@@1` | `license` | `dd1081884a92952802f4803110a6bb543acea9a814c786d58605b4c1219b5ebb` |
| `N09` | `package/license` | `dd1081884a92952802f4803110a6bb543acea9a814c786d58605b4c1219b5ebb` |
| `B/mdast-util-math@3.0.0@@@1` | `license` | `536804b3adbff17dbbb9ed0d2bf9655b78f07640278581e37e3d7475282d5e61` |
| `N11` | `package/license` | `536804b3adbff17dbbb9ed0d2bf9655b78f07640278581e37e3d7475282d5e61` |

- All full license body files attached to available exact direct pins above contain the MIT permission grant. No exact `highlight.js@11.12.0` BSD body, `playwright-core@1.63.0` Apache body or KaTeX0.18.7 font/license inventory is available in inspected caches.
- `B/remark-math@6.0.0@@@1/readme.md` and `B/rehype-katex@7.0.1@@@1/readme.md` point to `https://github.com/remarkjs/remark-math/blob/main/license`; both README license sections attribute MIT to Junyoung Choi, but this link/SPDX is not a retrieved full notice body. No network request was made.
- `ws` has `index.js` (796 B), `wrapper.mjs` (554 B), 13 `lib/*.js` files and `LICENSE` (1183 B). Direct `require.resolve("ws")` → `/home/mirako/abel/cadence/node_modules/ws/index.js`; `require.resolve("ws/package.json")` → matching local manifest. Manifest has no mandatory runtime dependencies; `bufferutil`/`utf-8-validate` peers are optional, not a feature provisioning requirement. Runtime was not imported or exercised.

## Selected transitive / build prerequisites

These are source-lock inventory leads, not additional approved direct dependencies and not an exhaustive dependency closure. Missing exact Rolldown/platform binding and vis dependencies are independently relevant even if a top-level package becomes available.

| Package | Reference lock pin | C | B | N | Exact artifact source |
| --- | --- | --- | --- | --- | --- |
| `rolldown` | 1.2.9 | 1.2.4 | 1.2.4 | 1.1.3, 1.1.5, 1.2.3 | **MISSING** |
| `@rolldown/binding-linux-x64-gnu` | 1.2.9 | 1.2.4 | 1.2.4 | 1.1.5, 1.2.3 | **MISSING** |
| `scheduler` | 0.28.0 | — | 0.27.0 | 0.27.0, 0.28.0 | `N33` |
| `vis-data` | 8.0.5 | — | — | — | **MISSING** |
| `vis-util` | 6.0.2 | — | — | — | **MISSING** |
| `@egjs/hammerjs` | 2.0.17 | — | — | — | **MISSING** |
| `moment` | 2.30.1 | — | — | — | **MISSING** |

- Reference React DOM19.3.0 requires scheduler `^0.28.0`; exact0.28.0 tarball exists in N (B has only0.27.0). React types19.3.0 require `csstype ^3.2.2`; its closure is not qualified here.
- Reference Vite8.3.0 declares Rolldown `~1.2.6` (lock1.2.9), lightningcss `^1.33.0`, picomatch `^4.0.7`, postcss `^8.5.28` and tinyglobby `^0.2.17`; closure/platform binary/license work remains. Vite8.2.1/Rolldown1.2.4 already in C do not satisfy the approved exact pins.
- Exact `rehype-katex@7.0.1` metadata requires `katex ^0.16.0`, while the approved direct pin is0.18.7. Existing0.16.45/0.16.47 cache bodies may be relevant to the transitive closure, but cannot replace approved0.18.7. Resolve/audit both actual bodies if the eventual lock retains both; no override or dependency change is proposed here.

## Existing checkout toolchain (not a new web-build qualification)

| Package | Observed installed version | Public manifest | Entry/body presence |
| --- | --- | --- | --- |
| `@earendil-works/pi-coding-agent` | 0.84.3 | `C/@earendil-works/pi-coding-agent/package.json` | all listed main/type/bin targets present |
| `@earendil-works/pi-ai` | 0.84.3 | `C/@earendil-works/pi-ai/package.json` | all listed main/type/bin targets present |
| `@earendil-works/pi-tui` | 0.84.3 | `C/@earendil-works/pi-tui/package.json` | all listed main/type/bin targets present |
| `undici` | 8.9.0 | `C/undici/package.json` | all listed main/type/bin targets present |
| `typebox` | 1.3.7 | `C/typebox/package.json` | all listed main/type/bin targets present |
| `typescript` | 6.0.3 | `C/typescript/package.json` | all listed main/type/bin targets present |
| `vitest` | 4.1.10 | `C/vitest/package.json` | all listed main/type/bin targets present |
| `@types/node` | 22.20.1 | `C/@types/node/package.json` | all listed main/type/bin targets present |
| `@biomejs/biome` | 2.5.8 | `C/@biomejs/biome/package.json` | all listed main/type/bin targets present |
| `rumdl` | 0.2.55 | `C/rumdl/package.json` | all listed main/type/bin targets present |

- Runtime tools: `/usr/bin/node --version` → `v26.7.0`; `/usr/bin/bun --version` → `1.3.14`. Only version probes were run. The observed Node version satisfies the reference Vite/plugin Node engine expression (`^20.19.0 || >=22.12.0`) as metadata, not executed compatibility evidence.
- The older planning table said Vitest4.1.8; installed manifest is4.1.10 (current package declares `^4.1.8`). Biome2.5.8/rumdl0.2.55 likewise reflect actual manifests under existing ranges. No tooling version/lock was changed or silently selected.
- Current `package.json` still has no production `dependencies` edge and none of the new browser/dev additions. Existing ws resolution does not remove the explicit direct-edge/isolated lock provisioning gate.
- SDK0.84.3, Undici8.9.0 and typebox1.3.7 are the local public installed identities; no global SDK fallback was searched or suggested. No Pi API documentation/API research or SDK construction was required for this metadata-only task.

## Standalone browser executable availability

| Lookup/executable | Version-only result | Limitation |
| --- | --- | --- |
| `/usr/bin/firefox` (on PATH) | `Mozilla Firefox 153.0.4` | System Firefox, not evidence of Playwright-compatible patched Firefox |
| `/home/mirako/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` | `Google Chrome for Testing 151.0.7922.34` | Explicit existing standalone candidate; no session/profile opened |
| `/home/mirako/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell` | `Google Chrome for Testing 151.0.7922.34` | Existing standalone headless candidate; version only |

- `command -v` found no PATH `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `chrome`, `firefox-esr` or `playwright`. The two Chromium paths above were separately looked up by absolute executable path; both `--version` probes exited0.
- `/home/mirako/.cache/ms-playwright` directory-name inspection showed `chromium-1234`, `chromium_headless_shell-1234`, `ffmpeg-1011`. No personal browser-profile directory or browser environment/settings was consulted.
- A later authorized real-browser qualification can explicitly supply the existing Chromium as `CADENCE_BROWSER_PATH` and use a newly owned isolated profile/context. This is an option, not an invocation performed here. `playwright-core@1.63.0` is still absent; cached1.57.0/1.58.2/1.62.1 are not replacements. Executable version alone does not prove dependencies, launch, protocol compatibility, rendering, isolation or acceptance.

## Reference vendor / source license artifacts

| Existing public artifact | Bytes | SHA-256 |
| --- | --- | --- |
| `U/LICENSE` | 1089 | `a8068b68c721f3c80c9e17ecf31b325e12e85cb4da9be5b48bd60f36b1ff039c` |
| `U/plugins/run-trace/client/vendor/vis-timeline.bundle.mjs` | 548691 | `2363507df6ccd907ecd1757db45f3fd4e068a3b1ce2c86711c584ce966f37578` |
| `U/plugins/run-trace/client/vendor/vis-timeline.css` | 19837 | `67273f3f1bfc5fee585494e8b8818d7cad98c229737488bc56f140547badc1f5` |

- U `LICENSE` is the complete MIT body, copyright2026 xing-shuyin. U `scripts/build-runtrace-vendor.mjs` exists (1584 B), but was not executed. U has no built `web/dist` to reuse.
- Existing vendor bundle header identifies vis-timeline8.5.4 standalone, copyright2011–2017 Almende /2017–2019 visjs contributors and Apache-2.0-or-MIT choice. It includes a pre-existing build date; these are existing artifact bytes, not proof of a deterministic Cadence rebuild.
- The prebuilt JS/CSS are available offline as reference artifacts, **not substitutes for absent exact vis package input/full bundled notices or proof of reproducibility**. Header/license links do not establish all embedded dependency license obligations; keep final notice/closure gate open.

## npm tarball index (no extraction / no request-index inspection)

Scan counts: `{"content_files": 4419, "gzip_tarballs": 1664, "other_package_tarballs": 1623, "tar_errors": 0, "target_tarballs": 41}`. Only target package metadata/license bodies were retained in this report; other public package tar manifests were discarded after identifying they were outside the requested inventory.

All indexed tarball SHA-512 bytes were compared to their content-address filename. “Lock” compares actual tar bytes to U `package-lock.json` integrity only where package version equals that reference pin; it is integrity evidence against that file, **not registry authenticity or installed-tree verification**.

| ID | Package/version | Path relative to N | Bytes / regular members | Content SHA-512 / reference lock | License bodies |
| --- | --- | --- | --- | --- | --- |
| `N01` | `@rolldown/binding-linux-x64-gnu@1.1.5` | `sha512/16/37/2910a53227280782cd68e7455836f92de7eecb7bf544758b7402446990bdf7327c907f0afc979997c0c99f9936f230faf9bc92c2fbcfc677d8179f053541` | 7790863 B / 3 | MATCH / not compared (different pin/no integrity) | **no license body file** |
| `N02` | `@rolldown/binding-linux-x64-gnu@1.2.3` | `sha512/4f/2b/4cc05d8a546a8fdad81dd08d4e6343c0bfbf1d651018705e6cb03ce3337e125170840f7b97bd2779fa51e80b46d30fa784745cfb2dd40d08ed72d28564f7` | 7963403 B / 3 | MATCH / not compared (different pin/no integrity) | **no license body file** |
| `N03` | `@types/react@19.2.14` | `sha512/8a/57/131ff52788290c76d7b192808dd1b23ba4c7090ef99014fbee3ef98469803f3527c54c081d5122c0a158da4499bbfba3ef70cfaad7360ec12e304d8305f7` | 77920 B / 16 | MATCH / not compared (different pin/no integrity) | `react/LICENSE` (1141 B) |
| `N04` | `@types/react@19.2.18` | `sha512/02/7c/db04446cacb2ad9365d27d36d844b8d03ddcb5d7a4adcb8abe4fe069dc80b897a8cd06fade54f0079a9abdaa15d033b09764f8cb56618cc3db32fa1c50df` | 77946 B / 16 | MATCH / not compared (different pin/no integrity) | `react/LICENSE` (1141 B) |
| `N05` | `@types/react@19.3.0` | `sha512/37/4a/c50ae1fd628c46f7f9bad65f4c7e924a7e62ce554d1e9bb8a9233e9346049292f45e2c1f6f2fce4607ecabf01b3995eaa9be0f7a252c05e194b5b38be242` | 77822 B / 16 | MATCH / MATCH | `react/LICENSE` (1141 B) |
| `N06` | `@vitejs/plugin-react@5.2.0` | `sha512/62/62/a47e13808b7c2c0753e126ae52723dc65cc9f75afb50fc90b4c68a29b87a1749d9ad752b4ea45ad8693d6489ed9880505c21eeb844eccc6118c2ad839d63` | 14858 B / 7 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1103 B) |
| `N07` | `katex@0.16.45` | `sha512/a5/0a/596dd06eef0093990521eee7cf98baf4a45a0e6e7194a0bff286dc090e09a64296e483fd07495b62db916ee2b99dd68091e8d1967bdbea4d6b96bf719c34` | 1489056 B / 210 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1107 B) |
| `N08` | `katex@0.16.47` | `sha512/11/ea/3c62cd5da14d73fb1f0066c3e942efa9fd0719048e4f78ea3b40641dcb6c769b4314fe161a8016c63a65f0af92956c47d5b96bfd2e99d059e7a1a20bab8e` | 1495784 B / 212 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1107 B) |
| `N09` | `mdast-util-from-markdown@2.0.3` | `sha512/5b/89/80593bd294abdff0be89f9537dc8b4aa43d00e000bc7ba80c098f933e1d1dfe79de6e60563d9e8da747261a0999c9b11273afe8f6bc5c9869c44f7791bf1` | 18595 B / 17 | MATCH / MATCH | `package/license` (1094 B) |
| `N10` | `mdast-util-from-markdown@2.1.0` | `sha512/29/12/e098f68fd87d6e9766e9a0990e4bef6901c0c0023f4dbb59aa2e787c34b7891b9b65be3e364c7f343c8181a513969515cb934943ad636e642172fedb01e0` | 21204 B / 17 | MATCH / not compared (different pin/no integrity) | `package/license` (1094 B) |
| `N11` | `mdast-util-math@3.0.0` | `sha512/4e/5f/4604d786fc08499d0336db56c94761cfbcb3929cb13f4fd70923db6573acf0424da73e4ff87f470790e7448b140f0bf8fc52d2837484ecc2f2c0cb5399d7` | 8594 B / 7 | MATCH / MATCH | `package/license` (1099 B) |
| `N12` | `micromark-util-types@2.0.2` | `sha512/63/0d/04092a49a15885d6a4d4e030ba370b42e1a586b75124cda401f0a3cfc82451f33f5359e5741db1051933be658d70076db39b19c9aa13f24e93950a97874c` | 11701 B / 5 | MATCH / MATCH | `package/license` (1094 B) |
| `N13` | `micromark-util-types@2.0.3` | `sha512/a3/10/76224d37848d20bfe54d9fdb67875b756047bd3033e9b558801207dd7f76101ec9f4a7319380276548225773086a9bca61684b8cef3784bb7410cd506b3e` | 11515 B / 5 | MATCH / not compared (different pin/no integrity) | `package/license` (1094 B) |
| `N14` | `playwright-core@1.57.0` | `sha512/6a/04/dc2a5330fe68c158e9c3ea4159b6d000187822fcdc34099da8e89a9649b325236d7d94014b6590b2a81c93b2f54026ae570391fc700e8faef051a41584b9` | 1987032 B / 335 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (11601 B); `package/NOTICE` (254 B) |
| `N15` | `playwright-core@1.58.2` | `sha512/c9/99/04b5fb60c12f02b1f628ee79b4284f23b2f9ba8bf3d3815b41f032fbdbac0d7fa1f620cb03bb10a9263e7d2836b10ad4a7ad66a7d80783a8cec905aba5b6` | 2208739 B / 363 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (11601 B); `package/NOTICE` (254 B) |
| `N16` | `playwright-core@1.62.1` | `sha512/c0/f6/12c0404963d187ada2125eacaab71d276b42e93b75c45fb8cd0e19ed6dec7bb73512ee42e766c3a516bb85241e078bfae10cc8d71aa1dec0367af2761957` | 3070300 B / 111 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (11601 B); `package/NOTICE` (254 B) |
| `N17` | `react@19.2.5` | `sha512/96/55/092f3cf5cd3501aec92dda9c1980bab9f407a689f21fb70e1a07b2713aa7f51d8d850da183c60c2900f5731d4d6475669b1fb15ab8fe22d6811e7abd9608` | 24804 B / 27 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1088 B) |
| `N18` | `react@19.2.8` | `sha512/3d/66/980352ffabdbb6bbbc58422f98dcbdd87e789eed7c8b79a248095d4c183e8ba6bb01c5c02a1a3632af4798de9f9076c03ec7f22b92de1089ff03eb7f926f` | 24799 B / 27 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1088 B) |
| `N19` | `react@19.3.0` | `sha512/13/c2/d471bb415addb46db9766281dfc7864305dc554df38ab42667f5c0d227897afe7ba8029729201723e3bb76c19a155fc836647b8c1db892860091d53e52a2` | 26394 B / 27 | MATCH / MATCH | `package/LICENSE` (1088 B) |
| `N20` | `react-dom@19.2.5` | `sha512/27/96/c0673f835cc3305bfc15df1cca91ee7d01fe821d8ec6e2e60b3753af05c284b163ace29404c63f3a04129a9b197f224e5bc7dc213abbc19520df5b38126a` | 1276388 B / 43 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1088 B) |
| `N21` | `react-dom@19.2.8` | `sha512/ad/5a/6b8a67c6046dc347e4ead08406d834f93f12ad8755881839a3e723e6973af86017bbbb213e0eee2856a4c35d948718619746d4c910649278fc9008c06095` | 1276383 B / 43 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1088 B) |
| `N22` | `react-dom@19.3.0` | `sha512/24/39/3c76089fe753a31680c4ef4f8e4fd202c98afeebd1e59a284dc29d7e36c7db9dadede6c22209af59264b43990e3fd5bfeb9f6ea1200476b985c332be6bd1` | 1409226 B / 43 | MATCH / MATCH | `package/LICENSE` (1088 B) |
| `N23` | `react-markdown@10.1.0` | `sha512/a8/ac/55a292d3fd3c80e815f751ee4dc1a6ceb00ce6d10ee400fc2ae8bfb0583c22b18b3b47cbd9d27457aaaeab92e79ba31a648ef2c653d7d689f897fd9645c5` | 15544 B / 9 | MATCH / MATCH | `package/license` (1079 B) |
| `N24` | `rehype-katex@7.0.1` | `sha512/3a/23/36c2b67fc2e84a9228004a8745a28f308a61b71f5d8b590687f2a48f5499fd6a958a1521f760e0ad6caa41a2b4d5c3f788edcb93db55c16efc04b306c838` | 5863 B / 8 | MATCH / MATCH | **no license body file** |
| `N25` | `remark-breaks@4.0.0` | `sha512/22/31/2324e907e05b89bc7655216d100835b1706f7a902abb027fca547d8d7c97baaca654d80b07781dce1233cd4718b8402df85ddc7b236286627e88a53ee0c5` | 4499 B / 7 | MATCH / MATCH | `package/license` (1099 B) |
| `N26` | `remark-gfm@4.0.1` | `sha512/d6/ab/a87d9d9143d11675e377e12efdf8a131575efae3ec02506a29e423cbd5619d0f4a1c3e9bbdd65ccf19bc163040a9129778da4246430cd17f2a2ff63e3236` | 7621 B / 8 | MATCH / MATCH | `package/license` (1094 B) |
| `N27` | `remark-math@6.0.0` | `sha512/30/ca/a09cfef8220cbe4b75b09e143b92a1a511ead31135ccbc986b5330e2915676feea202426fe587520f7b84af7f8dc7dcd1d903ef7b372cdf33538f5c4c4b4` | 4741 B / 6 | MATCH / MATCH | **no license body file** |
| `N28` | `remark-parse@11.0.0` | `sha512/14/2c/6528b3469274b96daff5966a588a3314cd7d9eb315b9c50aa35b1c3678715f4b631275a1d520d166863a3ea8dd5685984d8a6ab475901337da47d080eba4` | 6458 B / 7 | MATCH / MATCH | `package/license` (1099 B) |
| `N29` | `rolldown@1.1.3` | `sha512/d4/5d/5e12d501b45bdc1a6d4743d4e25085073d01bb99200e0eb848ce3c6850416ea3c39c6eb18b8952e47af3608fce131389671ef9ee9b01638493b912ed77e6` | 176056 B / 48 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1302 B) |
| `N30` | `rolldown@1.1.5` | `sha512/b7/dc/f6f5c2635dffefc50f1dca1092a6de87e9a4b01d393c713e48de2cba48c5ee169939981e8f2fa5df0bc3c2c2b3d3c7ddee7702949bd1d1b5e0254c604b88` | 179825 B / 49 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1302 B) |
| `N31` | `rolldown@1.2.3` | `sha512/ae/7f/70a66c6994b7fb34b3720a4f45c9687714ce370db63c8cecc27443f31fbb9f9614dfb516c2129aa2e8bcb6a2c82853c3b039bb666af31b58b696cb82d7ec` | 192821 B / 54 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1302 B) |
| `N32` | `scheduler@0.27.0` | `sha512/78/db/fe5ab55b2aed5fdef6d8253ff1b62179b320391cf20cb5ff48818fe72a0d2c5aacc0504bea63fc66ece71973fa9a7cbc7f88ef4580e99e480a78bf9b62fd` | 10015 B / 15 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1088 B) |
| `N33` | `scheduler@0.28.0` | `sha512/8e/ea/2b7c2988908c3cb53fa9e415d29ba3c98d017fc9c11898acb3511088b7f45a64884bf8fba56d0f58bb6cf51dd3890dda834e5c40d7ec4a0661d726c73303` | 10011 B / 15 | MATCH / MATCH | `package/LICENSE` (1088 B) |
| `N34` | `unified@11.0.5` | `sha512/c4/ab/c684f5b0de4f3842387c6c8dd97898ea9f269d2be18416d6b349f66ffeb29e4e44e3389868ea616a87648cf7a888719a24c623a983bf066b34d283cf8a1c` | 30905 B / 11 | MATCH / MATCH | `package/license` (1099 B) |
| `N35` | `vite@6.4.2` | `sha512/d8/df/f9e6be090c9e2076b0af1a020d332f871f7891a4d233f0ae9217056c03e25b41270b882f9c966031060c2248f81c1bd535e509afa82196ccc6ea75ae7319` | 632135 B / 35 | MATCH / not compared (different pin/no integrity) | `package/LICENSE.md` (115630 B) |
| `N36` | `vite@6.4.3` | `sha512/35/32/a57108e500aecc950a326fa2e06aa1dcf2cb28fe9572509616330b378e0db5b93270fcb75da8814f70fa8fe8fce981b21c672288f39b051381c1ad00c0f0` | 632844 B / 35 | MATCH / not compared (different pin/no integrity) | `package/LICENSE.md` (115624 B) |
| `N37` | `vite@6.4.4` | `sha512/c4/68/d4fd2ca378dc9bd04e0ac5706f633ff50bedc95eeba3bdfda15cd3ad9e5704fb9f28e5a8ddf4ddbf9f656192226fa423f6a906ac9d4a71e4f5cd788fa9d5` | 635040 B / 35 | MATCH / not compared (different pin/no integrity) | `package/LICENSE.md` (115624 B) |
| `N38` | `vite@8.1.2` | `sha512/e9/86/0f6d15d3c71e9b45798e9fb5dd9d0032e4340d1e10e0b638431c8d77a1ee2963dde491c746256c691b03a6fbefd68744294210eba48a1532b9abb08e4019` | 547233 B / 36 | MATCH / not compared (different pin/no integrity) | `package/LICENSE.md` (110976 B) |
| `N39` | `vite@8.1.5` | `sha512/ed/42/cbc2c09d631fe7472ae9884c2fa9be53147acc559c81b7eae0fce0174fbae08ffcfe0ed4c3c8a15e2c074392e6c3543283f233ac9dd9b2ee6e795dc7d4b3` | 549330 B / 35 | MATCH / not compared (different pin/no integrity) | `package/LICENSE.md` (110976 B) |
| `N40` | `vite@8.2.1` | `sha512/11/4f/de4bb047dd744e1e1d989c179f8cce8304a03a65e31911841b8fb34b5a0e701d896107c07f31ac9de57b205aaf8d15871c0ce4de991a5d113591e8a6bf97` | 573565 B / 36 | MATCH / not compared (different pin/no integrity) | `package/LICENSE.md` (112425 B) |
| `N41` | `ws@8.21.1` | `sha512/fb/43/539d6efb7c537f0e3422ea4fd2abf62f9384a06a3c3bbab5bc57e6ac8d79d1803b3d8321a475bec4ce07e10388285ec44864a136f1fcc85c11c4ce1ba25b` | 34995 B / 19 | MATCH / not compared (different pin/no integrity) | `package/LICENSE` (1183 B) |

## Safe offline next options / explicit stop conditions

1. W1 can use the existing ws8.21.3 public installed body as an available prerequisite in later authorized work; add/audit its exact direct production edge deliberately. Missing @types/ws8.18.1 remains a provisioning blocker; do not create a substitute ambient declaration or silently take another version to claim the planned type edge exists.
2. For later explicitly authorized provisioning, trusted B expanded artifacts and exact N tarballs can be inputs to a private isolated staging/cache copy, after safe archive/member/body/lineage review. Do not modify shared caches or use unvalidated tar extraction. npm tarball presence does **not** prove Bun can consume it offline without an explicit bridge/metadata strategy; none was attempted.
3. Keep normal Bun lockfile-only generation lifecycle-disabled, externally network-disabled, with isolated HOME/config/temp/cache and preserved failures/preimages per distribution spec. This task did not run it. A missing artifact/cache record must stop that attempt, not cause automatic download, replacement pin, global lookup or lock hand-edit.
4. Use the explicit existing Chromium path only in a separately authorized isolated real-browser run after exact Playwright/tool/build prerequisites are provisioned. No personal/dev-browser profile, auto-download or browser session is needed to finish this discovery.
5. Obtain the twelve missing exact direct pins plus required transitive/platform/license/font bodies through a separately authorized trusted provisioning route, or return any proposed pin/design change to parent review. The inventoried exact-pin artifacts alone cannot provision the complete offline build as it stands.
6. Independently audit the actual bundled closure and notices (especially math package full MIT bodies, KaTeX fonts, Feather/icon-set notices, vis internals), deterministic builds and actual extracted package/browser/SDK integration. This inventory is not a passing build/test/license-compliance/runtime receipt.

## Evidence limits / command issues

- Initial combined current-task/directory probe exited2 only because the permitted task `research/` directory did not yet exist; task resolution succeeded. This report creation supplies that directory as allowed.
- One directory-only `find ... -print` browser-cache listing was rewritten by the harness (`rtk find` warned that `-print` was ignored); listing still identified candidates. Final browser evidence uses explicit `command -v <absolute-path>` and `--version`, not that warning-bearing listing.
- No acceptance checks were run and no dependency/tool/browser was installed, imported for execution or upgraded. No full transitive closure or archive security audit is claimed. No files outside this report were intentionally written.
