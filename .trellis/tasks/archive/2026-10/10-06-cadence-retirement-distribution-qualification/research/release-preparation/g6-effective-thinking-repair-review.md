# G6 effective-thinking repair — independent engineering review

## Decision and scope

**PASS: the current three-file engineering candidate matches the approved minimal scope.**
No production blocker was found in the actual worker, tests, specification or retained current-input gates.
This is my independent review decision, not an inference from the implementation helper's outcome.
It is not whole verification, current native CI, modern G qualification, real workflow acceptance or G6 closure.

Reviewed proposal: [complete SDK semantic-alignment plan](./g6-sdk-semantic-alignment-plan.md), especially sections 4–5 and 8–9.
Only `src/sdk-worker.mjs`, `test/lightweight-sdk.test.ts` and `.trellis/spec/backend/lightweight-workflow-guidelines.md` are candidate implementation changes.
This review changed none of them; its sole public addition is this report.
The existing task and intentionally absent activation pointer were not changed.

## Frozen actual inputs and preservation

Recorded baseline revision is `f64fb93fcccf7f54fd23647efe8508f4c0b66c20`; no Git, HEAD or index operation was performed here.
Current SHA-256 values were independently read from actual files and matched every final retained gate:

```text
12fff81671cc0bd1d3011f43f9364531bba0a08007dd1abe728de00a676022f3  src/sdk-worker.mjs
0bbf677df23b51ef163c4e9da202839e3a43c7da59af8a2d5d58e6ac98e034ec  test/lightweight-sdk.test.ts
b753f991975284a1e0b8ac6782d811f6df609cdcabc3840bafd5bfbdfd0d0633  .trellis/spec/backend/lightweight-workflow-guidelines.md
```

The source owner's three original preimages remain present and match its baseline:

```text
099261e6e7bfa67696fb9c1ee74be839b5bc79fac996b2481dba5cd82ae9766b  worker preimage
653048f524381453053d8f1b8b6889a73dd99b470703b220e8cba0f8bf2f2686  SDK-test preimage
cffb753745cefb2a069c8a56d670f84365230e1245f1c1987251447b263bacdc  workflow-spec preimage
```

Finite byte/mode comparison against F's retained 222-path public source index found exactly those three body changes; the other 219 bodies and all 222 modes match.
The independently specified membership remains 34 regular package members, 16 source owners and three unchanged Agent bodies/pins.
Every historical F installed body and its recorded inode/mode/link/size/hash match the implementation baseline.
All 34 F bodies also match its unchanged original archive `ad912e455934788b1393e76774163e4ca10a9b8afb1bcc7fa8309ffeb3eb8719`.
Comparing current shipped source to that archive changes only the worker: 33/34 bodies and 15/16 source bodies remain equal.
No new archive was built or installed.

```text
c357e4033e50767a6e5935231411e5b55f03f2f3ff70d8483099ca07d7b10ce9  src/subagent-process.ts
160338264368de80721ca59cf7574355f758ee1cfb1fd7ad6f78b43134811b5d  package.json
bab6352115eb8c11edce70010dd5720553c650418c0a3a26a7fbe245ea8f1d50  bun.lock
```

All 7,690 finite named public peer files retain their recorded bytes, inodes, devices, link counts and sizes; both six-package version sets match.
Repository coding-agent/AI/TUI/agent-core remain 0.84.3, typebox 1.3.7 and Undici 8.9.0.
Trusted global counterparts remain 1.2.0, typebox 1.3.27 and Undici 8.10.2.
No root dependency, peer link or old consumer was retargeted or modified.
The supplied 133 unrelated untracked task files were not modified or reclassified; no new Git inventory was taken.
The missing historical 438-file preimage debt remains unresolved; nothing was reconstructed or described as restored.

## Worker semantics and privacy

The worker captures `thinkingLevel ?? "off"` once and passes precisely that captured value to the factory.
After assigning the returned session, it makes one protected public `session.thinkingLevel` access and strictly compares the result before stream wrapping, subscription, READY or prompt.
The existing fallback-message and model id/provider/API checks remain purposefully intact.
Missing, undefined, null, nonstring or mismatching effective values refuse; a throwing getter reaches the same fixed `session` / `model-substitution` first fault without inspecting its exception.
An undefined returned session is caught by that protected access, and absent-session cleanup safely avoids dereferencing it.
There is no coercion, effective-value logging, second getter read, clamp, setter, map filling, retry or model substitution.

The exact in-memory settings are compaction disabled, retry disabled and `cacheWarming: "off"`; the existing stream-level `maxRetries: 0` remains.
Modern warming can issue automatic refreshes outside the outer stream wrapper, so explicitly disabling its scheduler is justified rather than erasing `promptCache` metadata.
Model request/token limits and cache metadata are preserved; this is not a bill, request-count or hidden-request cap.
The JavaScript worker introduces no unsafe cross-version Settings cast.

The complete worker diff is limited to the captured level, effective-level check and cache-warming setting.
It does not rewrite model kind, executable, provider, endpoint, transport, auth fields or the parent launcher.
The existing resolved-auth projection remains intentional: auth base URL overrides model base URL, and already-resolved model headers are removed before literal resolver use.
Other JSON model fields remain spread through, not projected through an obsolete legacy allowlist.
This is not a new universal model validator or proof of full modern model equality.

Cleanup and diagnostics remain unchanged: owned Undici close starts and is rejection-handled before independent SDK cleanup awaits; unsubscribe, abort and dispose remain independently attempted.
No unowned dispatcher is restored or closed; first-fault retention and cleanup mask 0..15 remain fail-closed.
No protocol/diagnostic keys or allowances were added: at most two 512-byte snapshots share the existing 256 KiB aggregate cap.
Input 128 KiB, line/pending 64 KiB, 4,096 frames/events, final 16 KiB and existing timeout/stop bounds remain unchanged.
Success stderr remains empty; the exact original-PID warning codec and its invalid-warning controls were not weakened.

## Public API review, not modern execution

Read AGENTS and the maintained error, logging, directory, quality, workflow, storage, distribution, frontend boundary/quality and shared thinking guides before publication.
Public-package reads covered both complete SDK/model/settings guides and factory declarations, plus the relevant model, settings, session and agent method contracts and implementations.
Here L means repository `node_modules`, and M means `/home/mirako/.bun/install/global/node_modules`; these are public installed source, not runtime stores.

- L/M coding-agent `dist/core/sdk.d.ts` explicitly accepts model, thinking, resource loader and in-memory managers; both factory implementations clamp thinking despite an explicit model.
- L/M `dist/core/agent-session.js` getters at 587/1041 return actual agent-state thinking, not an options echo.
- L/M AI `dist/models.js` at 548–577/680–709 explain all three native clamp refusals and mapped-xhigh support.
- L/M settings in-memory factories clone into memory; L preserves the unused setting, while M's public setting and getter recognize `"off"`.
- M `sdk.js` and complete `cache-warmer.js` show the independent refresh path and early off-mode refusal; default streaming behavior is not controlled by `PI_OFFLINE` there.
- M coding-agent's compat Model import re-exports the same modern root Model through AI `compat.d.ts` → `index.d.ts` → `types.d.ts`, not a legacy 0.84 projection.
- Public agent instance `streamFunction` remains distinct from constructor `streamFn`; the existing wrapper uses the correct property.
- M `PromptOptions.preflightResult` reports accepted disposition strings, unlike L's boolean; it is not rejection notification, so modern rejection observability is not inferred from L or its mocks.

These reads support the small API choice, not an actual modern session/transport/provider result.
Rich modern `session.model` equality, effective xhigh and eligible-metadata warming-disabled construction controls remain pending in a separate isolated G peer domain, exactly as the updated specification states.

## Test changes and retained native controls

SDK cases increased from 217 to 237: **20 added**, not 20 additional installation invocations.
The additions are nine public-boundary matches, seven refusal cases, three genuine stock-SDK clamp refusals and one mapped-xhigh tool-result success.
All three existing mock constructors now expose effective thinking captured from factory options, preserving the old hook/model/callback/identity/counter/abort/event/cleanup assertions.
Exact settings assertions include the new public setting without weakening compaction/retry checks.

The match mock deliberately models the public structure; it is not independent proof that an SDK will honor every request.
Refusal fixtures independently vary the effective getter, count one installed-getter read, test absent-getter access separately, and assert zero opaque exception-property reads.
They assert no stream access, subscription, prompt or simulated request on refusal, with empty stdout and no file writes.
Real SDK negative and positive controls supplement this mock, rather than letting an options echo establish production validation.

All original seven success lanes still take their original `runProcess` path and assertions: key/tool-result, headers-only, diagnosis/planner readonly, fabricated OAuth Codex, resolved-baseURL/null-header and Azure-env.
The `toolLane` refactor preserves their truth table; only the additive xhigh lane uses the native raw observer.
That eighth lane asserts both wire requests carry xhigh, exact tools/auth/path, a real fixture write, actual tool-result follow-up, ready/write/final, stderr zero and original native close zero.
Its retained PID is 496788; both EOFs/input delivery are true, signal is null and force is false.

The three native stock-SDK refusal PIDs are 496887, 496900 and 496913.
They request nonreasoning high, nonreasoning xhigh and reasoning xhigh without a map, respectively.
Each retains original exit/close 1, null signal, input delivery, both EOFs and no force; stdout, loopback contacts/requests and file writes are zero.
All preserve the 20-second test / 15-second child budgets and fixed bounded diagnostics without raw canaries.

Existing DIRECT and VALIDATED_PROXY controls remain genuine production-parent/stock-worker observations on the changed worker.
DIRECT PID 497592 has sink contacts 2, proxy/CONNECT 0; PROXY PID 497605 has sink 0, proxy contacts 2 and exact CONNECTs 2 against the fixed-502 fake proxy.
Both retain actual nonzero original close, EOF/input/no-force facts; expected SDK failure proves routing, not inference success.
Plain/gzip fake-proxy success PIDs 497893/497906 retain sink 0, one request, empty stderr and original exit/close 0.
Diagnostic fields, cleanup masks, pair-warning controls, general/check environment policy and parent TLS/routing ownership were not changed.
All these controls use fabricated credentials and local fixtures, not real provider responses, normal profiles or real proxy discovery.

## Retained gates and failures

The producer's sterile `run.py`, finite Vitest launcher, actual stdout and original wait receipts were inspected rather than rerunning the suite.
Every final gate binds the exact three hashes above and records native wait returned, exit 0, null signal and no force:

- Syntax PID 496392; TypeScript no-emit PID 496394; canonical operator comparison PID 496401.
- Agent checks PID 496408; scoped Biome PID 496411; nonexcluded spec Markdown PID 496426.
- Focused tests PID **496438**: actual SDK **237** + process **176** + package contract **7** = **420 passed**, three files, no failed tests.

The first focused run PID 494471 also passed 420 on an older input hash; it overlaps and is not added to the total.
The first Biome failure PID 493985 remains exit 1 with its exact test preimage and original diagnostics; later formatting did not convert a failed product-test run into PASS.
The implementation helper PID 492793 separately returned exit 1; its final reason remains UNKNOWN and no implementation handoff was manufactured.
Its outcome is not relabelled PASS and does not negate independently bound successful product gates.

One review-support assumption failed: `tests-first-test-preimage.ts` hashes to `bf89ef4ce4ce708869fc22680675a6858bf93535e901eed43bea2760419cfbce`, not the first run's recorded `98693acba7eaaae5f6f3e139c0c14880a110e3d7e63de4d1414ea87bad13d6d1`.
Do not claim that similarly named file restores that first input; current-candidate evidence comes from the exact final input/wait/stdout, not that preimage.
The initial review audit exit 1, program and diagnostics remain retained; only this support assumption was corrected, then the finite static audit passed 49 checks with exit 0.
No product test, installation, native Start or whole gate was retried for this correction.
A mistaken read of nonexistent `preimages/baseline.json` is also recorded; the actual baseline and original preimages were read separately, not reconstructed.

## Remaining qualification boundary and custody

Whole verification, separate distribution/real pack, new G automatic installation, modern full-model/cache-warming controls and changed-candidate three-OS native CI remain pending.
CI38669341877 and historical native F evidence qualify the old worker/0.84 graph, not this changed worker.
Future baseline source three-OS 0.84 evidence and modern 1.2 Linux G evidence must remain separately labelled; neither implies modern three-OS qualification.
No real model/auth/profile observation, actual proxy, CODE Start, paid request or archival was performed or authorized by this review.
G6 remains OPEN/BLOCKED, not promoted by this engineering PASS.

Private review leaf O:

```text
/home/mirako/.local/state/cadence-release-qualification/744e5f0de9223044/qualification-7db986a-c8cef218/repair-final-bk0d8kjm/commit-push-audit/ci-round2-authenticated-cb9a5079/g6-effective-thinking-review-FrX3jW1Q
```

Its `corrected-audit/` receipts bind source 222, every F body, public peers, retained gates and fixed native facts; originals and the first failed audit remain beside them.
Implementation evidence remains under sibling `g6-effective-thinking-implementation-2d0s3ym4`, including `preimages/`, `baseline.json`, `public-peers-before.json`, final gate JSON/logs and `evidence-final/`.
Only new owned private files/directories use 0600/0700; no real model/auth/route/error payload was copied into this review.
The scoped nonwriting report Markdown wait and final report/input hashes are retained in O; documentation checks are not product gates.
