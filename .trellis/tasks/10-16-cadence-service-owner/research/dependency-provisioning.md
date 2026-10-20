# W1 isolated dependency and notice provisioning

## Scope and result

The delegated user message **“允许”** authorized public official package/license provisioning into a new private cache, followed by externally offline Bun lock generation.
This pass changes only this report and `dependency-provisioning.receipt.json` in this research directory.
No product source/tests, real `package.json`/`bun.lock`/`node_modules`, old reports, task state or Git state were intentionally changed.
No personal npm/Pi/provider configuration, credentials, browser profile or ambient proxy/auth environment was read or used.
No downloaded package code, lifecycle hook, product build/test, provider, service or browser was executed.
The existing browser candidate remains inventory only.

**Provisioning evidence, not product completion:**

- **26/26 exact planned direct versions:** official npm exact-version metadata HTTP200, correct name/version and SHA-512 integrity; **zero404**.
- **396 unique project-lock artifacts:** downloaded, compared against both registry and lock integrity, and tar-inspected before standard Bun installation.
- **393 packages /21,650 regular files:** isolated Bun cache bodies match their verified tarballs; no body mismatches.
- Three unsupported-platform artifacts are verified tarballs but were not populated into Bun's expanded cache by `--os=* --cpu=*`; see below.
- **Offline normal lock generation succeeded from a copy of the original lock plus the approved direct edges**, under Bubblewrap `--unshare-net`, after explicit metadata refresh.
  Two earlier offline failures are retained, not relabeled.
- A fresh **offline host install** of that generated lock also exited0, with `--ignore-scripts`; Bun reported342 installed packages.
  This demonstrates available-host package provisioning, not module/build/browser/native-platform compatibility.
- Seven additional exact artifacts were fetched **only for the prebuilt vis bundle's embedded notices**; total verified tarballs403, not403 installed project dependencies.
- Missing math MIT bodies, Feather attribution and KaTeX font-specific SIL OFL material were provisioned.
  Final adapted-source and emitted-bundle/license/member audits remain implementation work.

## Owned paths and custody

```text
P=/tmp/cadence-w1-provision-ar5oshfh
$P/environment.json                 complete clean allowlisted environment
$P/preimages/{package.json,bun.lock} original public inputs, unchanged
$P/bun-cache                       NEW isolated Bun cache
$P/responses                       all26 exact-version registry responses
$P/artifacts                       initial inert tarballs, including failed partials
$P/artifact-audits                  metadata, selected notice bodies and per-artifact receipts
$P/artifact-retries                 separate retry bodies/receipts; no failed preimage overwritten
$P/online-fixture                   first temporary manifest/online resolution/install
$P/offline-fixture                  first failed offline generation
$P/offline-prefer-fixture           second failed offline generation
$P/online-refresh-fixture           later explicit metadata-warmup resolution
$P/offline-fresh-fixture            successful offline-generated lock; NO node_modules
$P/offline-install-fixture          successful isolated offline host install
$P/licenses                        official bodies, font/source-map provenance and vendor build lock
$P/logs                            commands, exits, stdout/stderr and lock-alias difference
```

This root and all earlier failures remain preserved; no cleanup was run.
`dependency-provisioning.receipt.json` records exact URLs, integrity values, hashes, artifact/cache/notice paths, tool identities, command argv/environment, exits and hashed supporting receipts/scripts.
The bulky artifacts and full notice bodies remain in the private root, not the repository or a global cache.
Do not delete that root before the main-session handoff is complete.

Actual tools: `/usr/bin/node` v26.7.0, `/usr/bin/bun --version`1.3.14; installation banner separately says **1.3.14-canary.1 (0d9b296a)**; Bubblewrap0.11.2; curl8.21.0.
The available host is Linux/x86_64; no other OS/runtime was qualified.

## Exact direct pins

Every row returned HTTP200 at `https://registry.npmjs.org/<encoded-name>/<exact-version>` and its exact manifest was present in the successful offline host fixture.
Scoped names use `%2F`; full request URLs and commands are in the receipt.
Only `ws` is added as a production dependency; the other25 are development edges.

| Package                  | Exact version |
| ------------------------ | ------------- |
| ws                       | 8.21.3        |
| @types/ws                | 8.18.1        |
| react                    | 19.3.0        |
| react-dom                | 19.3.0        |
| react-icons              | 5.7.0         |
| @types/react             | 19.3.0        |
| @types/react-dom         | 19.3.0        |
| react-markdown           | 10.1.0        |
| remark-gfm               | 4.0.1         |
| remark-breaks            | 4.0.0         |
| remark-math              | 6.0.0         |
| rehype-highlight         | 7.0.2         |
| rehype-katex             | 7.0.1         |
| rehype-raw               | 7.0.0         |
| rehype-sanitize          | 6.0.0         |
| highlight.js             | 11.12.0       |
| katex                    | 0.18.7        |
| unified                  | 11.0.5        |
| remark-parse             | 11.0.0        |
| micromark-util-types     | 2.0.2         |
| mdast-util-from-markdown | 2.0.3         |
| mdast-util-math          | 3.0.0         |
| vis-timeline             | 8.5.4         |
| vite                     | 8.3.0         |
| @vitejs/plugin-react     | 6.1.1         |
| playwright-core          | 1.63.0        |

All original218 unique package identity/integrity pairs remain in the final396-identity closure.
The original lock has219 package rows; the final offline lock has414 rows because aliases can repeat identities.
Pi coding-agent/AI/TUI/core remain0.84.3; original direct ranges, public peers, scripts and unrelated manifest fields are preserved in the fixture.
No latest Pi replacement or global SDK was selected.

Transitive ranges resolved normally, not by copying the reference lock wholesale.
Examples: new Vite uses Rolldown1.2.14 while the original1.2.4 and Vite8.2.1 remain under existing dependencies; the runtime peer closure includes moment2.31.0 and uuid14.0.3.
KaTeX0.16.47 remains separately required by rehype-katex; it does not replace the approved direct0.18.7.
Those actual versions are fully inventoried; older planning transitive examples were not asserted to be frozen direct pins.

## Isolation, request bounds and artifact safety

Initial directories were created0700 with umask077.
Tool processes receive a newly constructed environment, not `process.env`/ambient shell exports:

- `PATH=/usr/bin:/bin`, `LANG=LC_ALL=C.UTF-8`.
- HOME, all four XDG homes, TMPDIR/TMP/TEMP, npm cache and Bun cache point inside `$P`.
- npm user/global config are new empty files; fixture `.npmrc` sets only public registry, ignore-scripts, audit=false and fund=false.
- `npm_config_registry=https://registry.npmjs.org/`, `npm_config_ignore_scripts=true`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`; isolated Bun runner also sets `DO_NOT_TRACK=1`.
- No npm/provider token, proxy, NODE_OPTIONS, Pi/session/control value or personal configuration is inherited.
- Curl starts with `-q`, uses explicit HTTPS, normal TLS verification, `--noproxy '*'`, no redirects and no automatic retries.

The26-pin preflight had four concurrent requests,8s connect/20s request/25s process bounds and2MiB per response.
Artifact inspection used at most eight concurrent requests,128MiB compressed/512MiB expanded per package,100,000 members,2MiB per selected manifest/notice and120s inspection deadline.
Original tar downloads had90s bounds; five explicit retry downloads used180s and concurrency2, with the same exact official URLs and fresh output paths.
Downloaded text was treated only as data, not instructions.
Registry/hash agreement is not a code-security audit or publisher-signature attestation.

Every tar was checked for package identity, SHA-512, member names, links/special/sparse/set-ID members and size bounds.
No `extractall`, archive-controlled output path or downloaded script was used by the inspector; notices were copied into numbered owned files.
Standard Bun subsequently performed installation with integrity verification enabled, `--ignore-scripts`, a frozen lock and `--backend=copyfile`.
Its expanded cache bodies were then independently compared with the verified tar members.

Three existing npm artifacts contain both `package/./dist/index.js` and `package/dist/index.js`: agent-base7.1.4, http-proxy-agent7.0.2 and https-proxy-agent7.0.6.
The first strict audit refused them.
Follow-up inspection proved each pair's bytes and modes identical; the revised **external-input-only** inspector permits only these three exact compressed SHA-256 identities and exact member pairs, rechecking equality.
No tarball was rewritten and no arbitrary path normalization/link exception was added.
Both the failed first audit and the narrowly reviewed evidence remain in `$P`; Cadence's own strict distribution/archive policy was not changed.

Bun ran inside a filesystem namespace exposing only system tooling/libraries, public certificate/DNS files, proc/dev and the new private root.
Neither the real checkout nor personal home was mounted.
Offline commands additionally used `--unshare-net`; the native capability probe showed a different network namespace, loopback only and no routes.
The first offline failures independently showed ConnectionRefused/FailedToOpenSocket rather than an online fallback.
`--prefer-offline` alone is **not** the network-enforcement mechanism.

## Executed command results and lock proof

All commands used `/usr/bin/bun install`; full Bubblewrap argv/environment are in `logs/*.receipt.json` and the repository receipt.

| Receipt label           | Mode    | Key flags                                         | Exit |
| ----------------------- | ------- | ------------------------------------------------- | ---- |
| online-metadata         | Online  | --lockfile-only --ignore-scripts                  | 0    |
| online-cache            | Online  | --frozen-lockfile --ignore-scripts --os=* --cpu=* | 0    |
| offline-lock            | Offline | --lockfile-only --ignore-scripts                  | 1    |
| offline-prefer-lock     | Offline | same, plus --prefer-offline                       | 1    |
| online-refresh-metadata | Online  | --prefer-offline --lockfile-only --ignore-scripts | 0    |
| offline-fresh-lock      | Offline | same, original lock + approved manifest again     | 0    |
| offline-install         | Offline | --frozen-lockfile --ignore-scripts                | 0    |

The two failed offline attempts could not resolve range metadata from the then-current cache.
An explicit new online metadata-warmup fixture followed immediately by a fresh network-isolated fixture succeeded.
This is evidence that freshly warmed metadata works here, not proof of indefinite cache freshness or that `--prefer-offline` suppresses every package-manager lookup.
Future aged-cache generation may refuse; never reconnect an offline attempt automatically.

Successful offline lock SHA-256:

```text
cc31e7ad885c21849b38515cb47bb9913b75801a3b484bf647e11fe354f47551
```

It is byte-identical to the separately generated refreshed-online lock.
The first online lock hash was `568795261234f8cbf1808fc81f89b1992a92e6bd5131709832dffb90ecc4fd37`.
Those two locks have identical package/version/integrity sets but different micromark-util-types alias placement; the exact diff is retained in `logs/lock-difference.diff`.
Do not claim cold/warm resolution is universally byte-deterministic.
No lock bytes were hand-edited or copied back into the repository.

The expanded cache lacks only these three members of the complete verified tarball closure:

- `@mariozechner/clipboard-linux-riscv64-gnu@0.3.9`.
- `@rolldown/binding-openharmony-arm64@1.2.14`.
- `@rolldown/binding-openharmony-arm64@1.2.4`.

Bun's all-OS/all-CPU invocation did not select those platforms.
Their original official tarballs and notices/metadata remain available; no synthetic Bun cache entry or unsupported-platform success was manufactured.
The successful offline342-package Linux host install establishes its selected closure, not those three platform lanes.

## Full-body notice and vendor/font findings

Full package notice bodies, not merely SPDX metadata, are retained with paths/byte hashes in the machine receipt.
The26 direct artifacts provide standalone notice files except remark-math and rehype-katex; their exact official Git commits supplied the missing bodies through GitHub's public Contents API.
All six initial raw.githubusercontent.com requests timed out with curl28/no HTTP response; these were transport failures, not404 package absence.
The official API route subsequently returned200 for the math and Feather bodies without credentials or an alternate registry.

- **pi-web-ui MIT:** preserved the local full body at pinned `e8bab487af208bc9a1ab60a821652323f598127f`, copyright2026 xing-shuyin, matching previously recorded SHA-256 `a8068b68c721f3c80c9e17ecf31b325e12e85cb4da9be5b48bd60f36b1ff039c`.
- **remark-math6.0.0:** full Junyoung Choi MIT from commit `d5d0660b150810a535bbb07eac6cc96a4510aa24`.
- **rehype-katex7.0.1:** full same-project MIT from its separate commit `88a9497e1ede93b958237c85edbf5651faeca7af`.
- **react-icons5.7.0:** root MIT explicitly says icon sets have independent licenses.
  Its package README pins Feather4.29.1; the full Cole Bemis MIT body was retrieved from official `feathericons/feather` tag `v4.29.1`, with API Git-blob identity checked.
  Other icon families were not licensed by inference; retained Lucide/other families would need their own review.
- **KaTeX fonts:** guessed `fonts/LICENSE` paths returned genuine404 at both exact KaTeX commits.
  Complete nontruncated upstream trees then matched all60 `dist/fonts` files per version by Git-blob identity:120/120 matches across0.18.7 and0.16.47.
  Actual TTF name tables identify **SIL Open Font License1.1**, Design Science2009–2010/Khan Academy2014–2018 and12 reserved font families; root KaTeX MIT is not the font license.
  The full official SIL text was fetched from `https://openfontlicense.org/documents/OFL.txt`.
  `$P/licenses/katex-distributed-font-notices.txt` combines the exact embedded notices with that full text; the original official template/body remains separately preserved.
  `src/fonts/lib/Extra.otf` is source-only package material, not one of the selected distribution60; audit it separately if later selected.
- **vis8.5.4:** registry standalone JS exactly matches the pinned pi-web-ui vendor after its single known header; CSS matches byte-for-byte.
  The package's own full MIT/Apache notices are retained; use the selected MIT branch without discarding embedded obligations.
  The standalone source map includes13 third-party families, not just its public peer dependencies.
  Its official build lock at commit `3948038f9b16854daa508b2d111cfec762bb057f` was fetched and Git-blob checked.
  A first20s response timeout is retained; the separate60s attempt succeeded.
- **Tooling:** full Vite/plugin licenses, Playwright Apache/NOTICE and its additional bundled `.LICENSE`/ThirdPartyNotices bodies are retained as development provenance, not mislabeled browser assets.
  Several Rolldown native-binding tarballs lack standalone full license files; complete native-binary embedded notice auditing was not performed.

The vis build lock/source map revealed versions different from the current project peer resolution.
Seven extra notice-only artifacts were fetched from official npm and integrity/member-checked: `@babel/runtime-corejs3@7.29.7`, `core-js-pure@3.49.0`, `style-inject@0.3.0`, `moment@2.30.1`, `uuid@14.0.1`, `vis-data@8.0.4`, `vis-util@6.0.0`.
Together with already fetched Hammer2.0.17, component-emitter1.3.1, cssfilter0.0.10, keycharm0.4.0, propagating-hammerjs3.0.0 and xss1.0.15, **all502 embedded source-map bodies match** their exact artifacts and have retained full notice bodies.
These additional versions were not injected into the project manifest/lock or executed.

This supplies concrete notice inputs; it does not establish the final emitted JS/CSS/font closure, tree shaking, adapted-source attribution or completed distribution-license audit.
Those gates remain with W6/W7 after actual implementation/builds.

## Reproduction and main-session handoff

All authored helper scripts are retained and hashed in the receipt.
They execute only standard tooling or inert-data inspection, not downloaded package modules.
Use a **new root** for a full rerun; existing scripts deliberately preserve attempt paths and some refuse overwriting.
The setup helper copies retained public preimages, not a live user configuration:

```sh
P=/tmp/cadence-w1-provision-ar5oshfh
R=$(/usr/bin/env -i PATH=/usr/bin:/bin LANG=C.UTF-8 \
  /usr/bin/python3 -I -B "$P/reproduce-setup.py")
clean_python() {
  /usr/bin/env -i PATH=/usr/bin:/bin LANG=C.UTF-8 /usr/bin/python3 -I -B "$@"
}
clean_python "$R/verify-pins.py"
# STOP unless all26 exact metadata responses validate.
clean_python "$R/prepare-fixture.py"
clean_python "$R/run-isolated.py" online-metadata online online-fixture \
  /usr/bin/bun install --lockfile-only --ignore-scripts \
  --registry=https://registry.npmjs.org/ --cache-dir="$R/bun-cache" \
  --config="$R/config/bunfig.toml" --network-concurrency=8 --no-progress
clean_python "$R/parse-locks.py"
clean_python "$R/audit-artifacts.py"
# Review any failure before continuing. retry-artifacts.py preserves originals
# and implements only the recorded exact external-input alias exceptions.
clean_python "$R/retry-artifacts.py"
clean_python "$R/run-isolated.py" online-cache online online-fixture \
  /usr/bin/bun install --frozen-lockfile --ignore-scripts \
  --registry=https://registry.npmjs.org/ --cache-dir="$R/bun-cache" \
  --config="$R/config/bunfig.toml" --network-concurrency=8 --no-progress \
  --backend=copyfile '--os=*' '--cpu=*'
```

For the successful offline-generation route, create two fresh fixture directories under that same new root.
In **each**, copy the augmented `online-fixture/package.json` and `.npmrc`, but copy `preimages/bun.lock`, not an already augmented lock.
Run the following online warmup and immediately the offline counterpart; this is explicit preparation, not a hidden fallback:

```sh
for F in online-refresh-fixture offline-fresh-fixture; do
  mkdir -m 700 "$R/$F"
  cp "$R/online-fixture/package.json" "$R/online-fixture/.npmrc" "$R/$F/"
  cp "$R/preimages/bun.lock" "$R/$F/bun.lock"
done
for MODE in online offline; do
  if [ "$MODE" = online ]; then F=online-refresh-fixture; else F=offline-fresh-fixture; fi
  clean_python "$R/run-isolated.py" "$MODE-fresh-lock" "$MODE" "$F" \
    /usr/bin/bun install --prefer-offline --lockfile-only --ignore-scripts \
    --registry=https://registry.npmjs.org/ --cache-dir="$R/bun-cache" \
    --config="$R/config/bunfig.toml" --network-concurrency=8 --no-progress || break
done
```

The offline host-install proof uses a third fresh fixture copied from successful `offline-fresh-fixture` inputs, then the same runner in offline mode with `--frozen-lockfile --ignore-scripts --backend=copyfile` instead of `--lockfile-only`.
Exact executed commands, including the original failed variants, are retained in the receipt; named scripts cover registry/tar/cache/vendor verification and official license requests.
Additional font/tree/license source URLs, curl limits, response hashes and derivation inputs are likewise recorded.
Future registry ranges/freshness can differ; rerun integrity and preservation comparisons rather than assuming this receipt describes future inputs.

**Main owns application:** review the unchanged original preimages, selected standard-generated lock, exact new edges, external-input alias evidence and final notices before any repository application.
Do not copy temporary node_modules/cache/lock automatically.
Preserve Pi0.84.3 and all unrelated locked identities; keep lifecycle scripts disabled and network isolation for subsequent offline lock work.
The three tarball-only platforms, metadata freshness limitation and final emitted-bundle/native-tooling notice audit remain explicit qualification limits.
No whole-product/native-runtime/browser/build/package pass, completion, commit or publication is claimed.

## Report verification scope

The machine receipt is checked with the existing repository Biome; report Markdown is checked on a byte-identical private copy with the existing `.rumdl.toml`, avoiding the configured task-directory exclusion without changing it.
The initial Markdown check found31 table-alignment issues; its log and exact failed report body remain in the private root.
Formatting changed only table-cell padding/separator widths; an initial whitespace-only comparison rejected separator-dash changes before copying, then explicit table-cell/non-table equality validated the correction.
Final lint results and receipt/artifact/hash consistency checks are recorded in the machine receipt.
No product tests/typechecks/builds were run for this provisioning-only pass.
Maintained-spec changes are left to the main session: cache freshness and actual font/vendor notices are handoff findings, not permission to modify specs or package policy here.
