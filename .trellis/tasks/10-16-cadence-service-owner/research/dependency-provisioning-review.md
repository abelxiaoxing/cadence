# Independent dependency-provisioning review

## Decision

**GO for main-session application of the exact 26 dependency edges and the reviewed offline-generated lock. No dependency-application blocker found.**

This decision applies only to the bytes identified below, after a fresh preimage comparison at application time. It does not authorize installing into the checkout, executing downloaded modules, changing pins, broad manifest replacement, or declaring W1/the product complete.

The provisioning is real registry/artifact/cache and isolated Bun-process evidence, not a product build or installed-runtime qualification. The three tarball-only platform artifacts and final emitted-asset/license audits remain explicit limits, not reasons to substitute versions or block these manifest/lock inputs.

## Authority, scope and inputs

- Resolved `python3 ./.trellis/scripts/task.py current --source`: `.trellis/tasks/10-16-cadence-service-owner`, session source.
- Read child manifests, PRD/design/implementation plan and [execution checkpoint](execution-checkpoint.md); parent [PRD](../../10-16-cadence-webui-terminal/prd.md), [design](../../10-16-cadence-webui-terminal/design.md), both mandatory design appendices and [implementation plan](../../10-16-cadence-webui-terminal/implement.md).
- Exact additions follow [client/distribution contract §12](../../10-16-cadence-webui-terminal/design-clients-distribution.md#12-build-dependencies-package-and-compatibility-changes) and its incorporated [dependency inventory §4](../../10-16-cadence-webui-terminal/research/design-ui-distribution.md#4-dependencybuild-decision-from-actual-manifests-and-lock). Selected parent contracts prevail over older research/spec recommendations.
- Applied backend [distribution](../../../spec/backend/task-distribution-guidelines.md), [quality](../../../spec/backend/quality-guidelines.md), index and shared reuse/cross-layer guidance. Inspected `scripts/package-audit.mjs`; its strict own-package policy remains separate from external dependency input inspection.
- Reviewed [provisioning report](dependency-provisioning.md), [machine receipt](dependency-provisioning.receipt.json) and actual supporting files under **`P=/tmp/cadence-w1-provision-ar5oshfh`**.
- This review writes only this new file. No Git/status, network, install, credential, product-test/build, downloaded-module execution or nested-agent operation was performed. Provisioning helpers were read, not executed. Independent inspection used `/usr/bin/python3 -I -B` and standard-library JSON/hash/tar/binary readers, with no extraction or cache writes.

Input report SHA-256: `05f2fac9aa571632c4a5d94ba20ec0601a67db7c646a92bc9636bf7d1b558b5f`.
Input receipt SHA-256: `a30530a0c5c5077db950c72736271953a15ab587e7850d5989d01b892b107a50`.

## 1. Independent preservation and exact-edge checks

Current repository inputs are byte-identical to the actual retained preimages, not merely to receipt assertions:

```text
package.json / P/preimages/package.json
  2023 bytes
  SHA256 160338264368de80721ca59cf7574355f758ee1cfb1fd7ad6f78b43134811b5d
bun.lock / P/preimages/bun.lock
  54554 bytes
  SHA256 bab6352115eb8c11edce70010dd5720553c650418c0a3a26a7fbe245ea8f1d50

P/offline-fresh-fixture/package.json
  2813 bytes
  SHA256 dec6786ac1c7d05c64326d8d6610628af7bb87693c1e383dedd932b353a28d76
P/offline-fresh-fixture/bun.lock
  106803 bytes
  SHA256 cc31e7ad885c21849b38515cb47bb9913b75801a3b484bf647e11fe354f47551
```

Parsed-object comparison independently established that the proposed manifest equals the original plus **only**:

```text
dependencies:
  ws 8.21.3

devDependencies:
  @types/ws 8.18.1
  react 19.3.0
  react-dom 19.3.0
  react-icons 5.7.0
  @types/react 19.3.0
  @types/react-dom 19.3.0
  react-markdown 10.1.0
  remark-gfm 4.0.1
  remark-breaks 4.0.0
  remark-math 6.0.0
  rehype-highlight 7.0.2
  rehype-katex 7.0.1
  rehype-raw 7.0.0
  rehype-sanitize 6.0.0
  highlight.js 11.12.0
  katex 0.18.7
  unified 11.0.5
  remark-parse 11.0.0
  micromark-util-types 2.0.2
  mdast-util-from-markdown 2.0.3
  mdast-util-math 3.0.0
  vis-timeline 8.5.4
  vite 8.3.0
  @vitejs/plugin-react 6.1.1
  playwright-core 1.63.0
```

All existing ranges, public peers, scripts and unrelated fields are unchanged. In particular no hook, SDK upgrade, global fallback, browser download or second production library was added. The fixture retains the original Node engine field; the parent's separately approved `>=22.19.0` metadata change remains implementation work, not an unrecorded part of these 26 edges.

All five preservation entries in the receipt still match actual public files, including the earlier availability/checkpoint reports and child task metadata. This is a bounded preservation check, not a claim to have inventoried the entire checkout.

### JSONC lock membership

An independent string-aware JSONC reader, with duplicate-key rejection, parsed the original, first-online, refreshed-online, final-offline and offline-install locks. It did not evaluate lock content or import a downloaded parser.

- Original: **219 rows / 218 distinct package-identity + integrity pairs**.
- First online: **413 rows / 396 distinct pairs**.
- Refreshed online, final offline and offline install: **414 rows / 396 distinct pairs**; these three locks are byte-identical.
- Every original identity/integrity survives. More strongly, every original package tuple, including dependency/platform metadata, survives unchanged apart from alias placement.
- All rows remain registry rows with SHA-512 integrity; lock/config versions are unchanged.
- All 26 exact direct entries agree across the proposed manifest, final lock workspace, top-level lock resolution and inert installed fixture manifests.
- Pi coding-agent/AI/TUI/agent-core remain **0.84.3**. Existing Typebox/Undici and other locked identities remain preserved.
- Final lock identities equal exactly the **396 project artifact** identities in the receipt. The **seven vis notice-only artifacts are disjoint** and were not introduced into the project lock.
- The first/final byte difference is precisely the retained [micromark alias diff](/tmp/cadence-w1-provision-ar5oshfh/logs/lock-difference.diff), not a version/integrity change. Do not claim universal cold/warm byte determinism.

The separate KaTeX `0.16.47` requirement and old/new Vite/Rolldown versions are genuine transitive coexistence, not replacements for the approved direct pins. Preserve the generated lock rather than hand-flattening aliases or copying the reference npm lock.

## 2. Integrity, cache and external-tar exception

Independent rehashing validated **1,250 distinct recorded path/hash/size bindings**, including all 13 retained helper scripts, 17 supporting evidence files, manifests, notices, artifacts and command outputs. The seven command objects also equal their actual `logs/*.receipt.json` files; recorded environments and offline/script flags agree.

A separate inert tar/cache inspection then established:

- **403/403 tarballs** match their recorded SHA-512 and official exact-version metadata; metadata name/version/tarball/integrity agree.
- **26,753 regular tar members** inspected; safe names, no links/special/sparse/set-ID members, bounded size/count, exact manifest identities, notice/font body hashes checked.
- **393 cache packages / 21,650 unique regular files** match tar bodies. Independent tree comparison found **no additional regular files**, missing bodies or linked/special cache members.
- Three project artifacts remain verified tarballs without expanded Bun cache entries: `@mariozechner/clipboard-linux-riscv64-gnu@0.3.9`, `@rolldown/binding-openharmony-arm64@1.2.14`, and `@rolldown/binding-openharmony-arm64@1.2.4`.

Evidence: [final artifact audit](/tmp/cadence-w1-provision-ar5oshfh/artifact-verification-final.json), [cache audit](/tmp/cadence-w1-provision-ar5oshfh/cache-verification.json), actual tar/cache paths in the machine receipt. Five failed downloads and three initial strict-name refusals remain in the original audit; successful retries did not erase them.

### Three same-body aliases: accepted only as exact external source inputs

For each following exact compressed artifact, the two original regular members are `package/./dist/index.js` and `package/dist/index.js`. Independent reads found equal bytes and mode **0644**:

```text
agent-base@7.1.4 — 7324 bytes each
  compressed SHA256 7dd4a61668a9a4e8d4e903f1a254f94d53dafd3f316f2b9b597c5ad8c79cb57e
  body SHA256       c6503bd5e007db8b73fedf07b6eaaf4a94d5541953f0d06c8a17d1644c29a0c5
http-proxy-agent@7.0.2 — 6088 bytes each
  compressed SHA256 785f73faa92bfba8d61da20bf59325ab2b3dca1bbc0bbac523406f404d8a6f02
  body SHA256       fd33b43da34da60d4914780e13fae5d52a7faaa996d687eea5335128de148627
https-proxy-agent@7.0.6 — 7451 bytes each
  compressed SHA256 960f89e8e5240882f64249d04a538421dd39d62ffacc138544647cc3251bc0e0
  body SHA256       30165586fac3becbc9dbf2b7b5bdaa802a77ac34af9926208f6e94a3bd87ef31
```

[audit-artifacts.py](/tmp/cadence-w1-provision-ar5oshfh/audit-artifacts.py) binds the exception to those exact compressed hashes, identities and member pairs, then rechecks size/hash/mode equality. Its diff against the preserved strict v1 inspector contains this narrow adaptation, not general path normalization or link acceptance. No tarball was rewritten.

**Do not transfer this exception to `scripts/package-audit.mjs`, expected member policy, package extraction tests or future versions.** That source still rejects dot-segment names and duplicate members. This review is not a pass of Cadence's distribution audit.

## 3. Isolation and offline-generation evidence

[run-isolated.py](/tmp/cadence-w1-provision-ar5oshfh/run-isolated.py) constructs the environment from the retained allowlist, adds only `DO_NOT_TRACK=1`, uses null stdin and normal closed-fd subprocess behavior, and runs Bun through Bubblewrap. The actual command receipts agree with that implementation.

- Private root mode is **0700**. HOME/XDG/temp/npm/Bun caches point inside it. The two npm config files are actually empty; fixture `.npmrc` contains only public registry, script/audit/fund policy. No ambient environment merge is present.
- Bun namespaces expose system tooling/libraries, certificate/DNS files, proc/dev and the private root, **not the checkout or personal home**. All Bun invocations have `--ignore-scripts`; installs are frozen-lockfile with `--backend=copyfile`; no integrity-disabling flag appears.
- Curl helpers use clean supplied environments, `-q`, verified HTTPS, explicit official endpoints, no redirects, no ambient proxy and bounded requests. Registry/body agreement is not publisher-signature or code-security attestation.
- Offline invocations add **`--unshare-net`**. The retained [native probe](/tmp/cadence-w1-provision-ar5oshfh/network-isolation-probe.json) reports a different namespace, only loopback and no routes. `--prefer-offline` is a preference, not the enforcement boundary.
- Both original offline attempts exited **1**, with actual ConnectionRefused/FailedToOpenSocket diagnostics. They remain failed. A separately named, explicitly online metadata warmup was followed by the fresh offline generation; no automatic online fallback is present in the runner.
- [Successful offline generation](/tmp/cadence-w1-provision-ar5oshfh/logs/offline-fresh-lock.receipt.json) ran standard `bun install --prefer-offline --lockfile-only --ignore-scripts` and exited **0**. Its fixture has no `node_modules`; output lock matches the refreshed-online lock exactly.
- [Offline host install](/tmp/cadence-w1-provision-ar5oshfh/logs/offline-install.receipt.json) exited **0**, reporting **342 packages**; direct/Pi manifests were independently read as inert JSON. This does not establish import/build/browser/native behavior.

Recorded tool identities are Node **26.7.0**, Bun `--version` **1.3.14**, install banner **1.3.14-canary.1 (0d9b296a)**, Bubblewrap **0.11.2**, curl **8.21.0**, Linux/x86_64. Do not collapse the differing Bun version presentations or imply a Node22/nonhost qualification.

Successful offline-generation receipt SHA-256: `4bcdf1f9f7552bd86ff1a9b3cd804c51d49fcf60a1324f9977680904d7e70d85`.
Offline-install receipt SHA-256: `6b609463eb6a459419b716cd52e9e74d003af3d1403c2e2d470cdaa6f7624466`.

### Traceability limitation, not a dependency-application blocker

The runner records argv/environment/output/exit, but **not pre-execution fixture input hashes**. `create-receipt.py` sets `offlineGeneratedFromOriginalLock: true` as an assertion; retained setup/preimages and the report describe that copy, but the successful fixture's overwritten starting lock cannot independently be recovered from its command receipt. Therefore this review corroborates the described procedure, actual offline command/output and exact preserved final graph; it does not claim an independently attested before-spawn input capture.

This does not invalidate application of the reviewed bytes: the original preimages, exact final edges, complete original tuples and generated lock identity were independently verified. For any new generation, capture fixture manifest/lock hashes before and after invocation in the same receipt. Do not rerun online or widen authority merely to improve this traceability. Cache freshness remains bounded to the recorded warmup/run, not indefinitely guaranteed.

## 4. Notices: actual bodies, not invented licenses

All retained notice bodies were rehashed and compared with their source tar members where applicable. Additional independent checks:

- **Math MIT:** decoded official GitHub Contents responses equal the saved full bodies and Git-blob hashes. `remark-math@6.0.0` and `rehype-katex@7.0.1` response refs match their exact registry `gitHead` values; both contain the actual Junyoung Choi notice, not a generic replacement. See [API requests](/tmp/cadence-w1-provision-ar5oshfh/license-api-requests.json).
- **Feather:** the actual react-icons package README identifies Feather **4.29.1**; its [official tagged LICENSE](https://api.github.com/repos/feathericons/feather/contents/LICENSE?ref=v4.29.1) response decodes to the retained Cole Bemis MIT and matching blob. This does not license Lucide or every other icon family by inference.
- **KaTeX:** independently matched **120/120 font bodies** to complete official tree blobs at the two exact package commits, decoded all **40 TTF name tables**, and matched their notice fields to the receipt. All **12 reserved-family texts** occur in the derived notice file. Its substantive OFL text is byte-identical to the full [official SIL body](https://openfontlicense.org/documents/OFL.txt); the derived file contains no invented placeholder copyright holders. Root KaTeX MIT does not cover these font obligations. See [font provenance](/tmp/cadence-w1-provision-ar5oshfh/font-provenance.json) and [derived notices](/tmp/cadence-w1-provision-ar5oshfh/licenses/katex-distributed-font-notices.txt).
- **vis:** independently decoded and Git-blob checked the exact official build lock, then compared **502/502 source-map bodies across 13 third-party families** with their pinned tar members. Every family has retained full notices. The seven extra artifacts supply these embedded versions only. Actual reference vendor JS equals the registry standalone after the single recorded header; CSS is byte-identical. See [vendor audit](/tmp/cadence-w1-provision-ar5oshfh/vendor-notice-audit.json) and [official build-lock receipt](/tmp/cadence-w1-provision-ar5oshfh/license-vendor-lock-request-final.json).
- **Reference/tooling:** pi-web-ui's preserved MIT matches the local reference and earlier pinned hash; Playwright supplemental `.LICENSE`/ThirdPartyNotices bodies match tar members. Vite/Playwright development provenance is not falsely counted as shipped browser code.

Transport timeouts remain timeouts; guessed KaTeX `fonts/LICENSE` 404s remain 404s. Neither was silently turned into package absence or an invented license. Source-only `Extra.otf`, other icon families and native-tooling embedded notices need separate review if selected/distributed.

## 5. Main-session application and remaining gates

1. **Apply only the reviewed edge delta and final lock**, with fresh comparisons against the original package/lock hashes above. If either current input differs, stop for a targeted merge/review; do not overwrite unrelated edits. Recheck the selected temporary inputs' hashes too. Do not copy temporary cache, `node_modules`, extra notice-only dependencies or a different lock automatically.
2. Preserve all failure receipts/preimages and this private provisioning root through handoff. A future aged-cache offline refusal is not permission to reconnect, upgrade or hand-edit a lock.
3. Main should append/link the new provisioning result when updating the checkpoint: its earlier statement that provisioning has not occurred is historical, not current evidence. Keep the old report and original failures intact.
4. **Not blockers to these package edges:** the three nonhost tarball-only cache gaps, unexecuted Windows/macOS/ConPTY/physical-device/provider lanes, and not-yet-assembled final notices. No unsupported-platform success is claimed.
5. **Still gates before corresponding implementation/delivery claims:** actual package/module/build/SDK/service/browser qualification; intended native binding availability at use; complete adapted-source and emitted JS/CSS/font/vendor provenance/notices; exact package member/body audits and real pack/extract. Missing native standalone notices remain a tooling/distribution review item, not a fabricated license clearance.
6. W1 reciprocal interface freeze, owner/auth implementation and all dependent/integrated acceptance remain open. Neither these provisioning receipts nor the earlier 114 portable tests satisfy those runtime gates.

No corrective dependency bytes or additional download are required for this **GO**. The input-capture limitation above must remain explicit rather than being promoted to stronger execution evidence.

## Review verification record

Readonly verification commands completed successfully for reference hashes, manifest/JSONC membership, full tar/cache bodies and font/vendor/API notice chains. Two preliminary reviewer inspections failed on local inspection assumptions (an archive-relative member name treated as a filesystem reference; a list-shaped font receipt assumed to be an object); corrected readonly inspections passed. These were not provisioning/package failures and caused no writes.

This report is the sole new output. No product lint/typecheck/test/build or provisioning rerun was performed, and no such pass is claimed.

Readonly report checks passed for UTF-8, final newline, balanced fences, trailing whitespace and all 23 local links; the original repository package/lock hashes were rechecked unchanged after writing. This is not a Markdown-linter or product-quality pass.
