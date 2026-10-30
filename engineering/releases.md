# Release acceptance evidence

An append-only record of what each release or integration review actually executed, newest first.
It is not required reading for a change: add a section for each release and never rewrite an older one.

## Release 2.0.18 acceptance snapshot

Full `verify` passed on the release candidate: 1911 root tests in 71 files (27 platform skips on Linux), 19 task-entry node tests, 136 web tests, 5 real-browser scenarios in 4 files and the 142-member real-pack audit.
Observed environment: Linux x86_64, official Node 22.22.1, Bun 1.3.14, Pi SDK 0.84.3 and Chrome for Testing 153.0.8010.12, with unchanged test deadlines.
A reported WebUI task Send that always stopped `stale` traced to the change identity, not the service epoch: a Git command cut off by its 512KiB output bound (a `node_modules` ignored listing is enough) hashed pipe-timed partial bytes, so one unchanged tree had a new identity on each observation; this checkout's own ignored listing (1.37MB) drifted in 1 of 5 consecutive observations.
Limited commands now hash a fixed outcome, wholly ignored directories count once and the hashed output bound is 16MiB; the new regression fails on the previous implementation.
Task Send reads the workspace again and binds the project, access and model shown, and a `stale` refusal names the moved fields.
The reporter's project was not available here; no consumer service was installed or restarted, no paid provider was used and the `ci/windows` matrix was not run.

## Release 2.0.17 acceptance snapshot

Full `verify` passed on the release candidate in about four minutes: 1908 root tests in 71 files (27 platform skips on Linux), 16 task-entry node tests, 136 web tests, 5 real-browser scenarios in 4 files and the 135-member real-pack audit.
Observed environment: Linux x86_64, official Node 22.22.1, Bun 1.3.14, Pi SDK 0.84.3 and Chrome for Testing 153.0.8010.12, with four root workers and unchanged test deadlines.
`verify` no longer runs the slow real-process, PTY, HTTPS-proxy browser and multi-MiB cold-scan suites; those behaviors are not regression-gated in this release.
Task Send creates a task and starts readonly analysis, and one Confirm plan and execute saves and starts the reviewed plan.
Fixes in that flow: a fenced receipt read is observed again instead of ending the sequence, a transient context gap no longer aborts an in-flight approval, and a failed observation is re-read after 2s rather than leaving actions disabled until the 30s reconcile.
Ordinary conversations show no recorded-view switch, and Runs includes the current snapshot's owner projection.
The first merged attempts failed a time-budgeted search page and the new plan-approval browser step, which also failed on its original commit; both causes were fixed, not retried around.
No consumer service was installed or restarted, no paid provider was used and no native Windows/macOS qualification is claimed; the `ci/windows` matrix still names the removed vitest projects and was not run.

## Release 2.0.16 acceptance snapshot

The final code candidate passed all 2070 root tests in 86 files (27 platform skips on Linux), 133 web tests, all 9 real-browser scenarios and the 135-member exact real-pack audit.
Source/type/build/lint/Agent checks and a separate Bun pack/body audit also passed; this is separate-lane evidence, not a claim that one `verify` invocation was entirely green.
Observed environment: Linux x86_64, Node26.7.0, Bun1.3.14, Pi SDK0.84.3 and existing Chrome for Testing151.0.7922.34, with `VITEST_MAX_WORKERS=1` and unchanged test deadlines.
Review added failing-then-passing regressions for a successor lock borrowing a stopped predecessor's PID, unexpected foreground management exceptions being misclassified as exit78, and an accepted Stop abandoning its exact-epoch wait after an inconclusive registration read.
The stopped-row recovery bridge must belong to the exact current lock; Stop never resends its request or infers closure from a read failure or successor epoch.
The first full attempt had three pre-existing test deadlines and a workbench Stop with empty CLI output; isolated diagnostics passed the timeout files, and the original timing and empty-output causes remain unconfirmed.
After the independently reproduced Stop race was fixed, the second full attempt passed root/web checks but every browser launch hit Chromium's explicit singleton-socket path-length refusal because the private temporary root was too long.
Using a fresh short private root on the same disk, all browser scenarios and the pack audit passed without code changes, larger budgets, skipped tests or downloads.
Failure logs and isolated receipts remain outside the checkout; no consumer service was installed/restarted, uncertain state cleaned, paid provider used or new native Windows/macOS qualification claimed.

## Workbench recovery review snapshot

The recovery review reproduces the still-reserved deleted-project failure, adds gateway-only native recovery (including legacy host attestation), and exercises restart/Stop after retiring old project associations without deleting references or project fences.
The new gateway recovery file passes 30 tests, including actual owner/resolver exits, concurrent resolvers, interrupted release, unsafe/changed resources, real generated startup refusal/restart/Stop and genuine POSIX TTY confirmation; global registry recovery passes 34 tests.
Full `verify` passed static/build/lint/Agent checks and reached 2064 passing root tests with 27 platform skips, but one unchanged `service-history-projection` dense-message test exceeded its 15s deadline.
Its complete 24-test file passed in a subsequent isolated diagnostic run (the affected case took 1.83s); the original timing cause is unconfirmed, not retrospectively successful.
After the final startup/Stop diagnostic wording correction, 121 targeted CLI/recovery tests, source/generated checks, 133 web tests, all 9 browser scenarios and the 135-member real-pack audit passed.
A separate Bun pack/body audit also passed; failures and isolated fixture receipts remain outside the checkout, with no increased test budgets, downloaded dependencies, consumer lock cleanup or service installation/restart.
Actual WSL shutdown, real service-manager installation and new native Windows/macOS recovery qualification were not executed; this is not a full green `verify` claim.

## Conversation-first entry review snapshot

The project-less conversation shell and folder-picker review passed 133 web tests, all 9 real-browser scenarios and the 135-member real-pack audit, plus a separate Bun pack/body audit.
New loopback and HTTPS regressions refuse Open after an unbrowsed path edit, retry the same readonly directory observation after failure, and fence Open while a refresh is pending; the two original picker defects were observed failing before their fixes.
Full `verify` passed its static/build/lint/Agent checks but stopped in the root suite: 2033 tests passed, 27 platform tests skipped, and the unchanged `service-history-search-export` field-kind/snapshot case exceeded its 5s deadline.
That complete 16-test file passed in a subsequent isolated diagnostic run (the affected case took 1.16s); the original timing cause is unconfirmed, and this is not a full green `verify` claim.
Failed logs were retained outside the checkout; no deadline was increased, test skipped to obtain green, dependency downloaded or consumer service installed/restarted.

## Release 2.0.15 acceptance snapshot

The release candidate passed the complete root suite: 2034 tests in 85 files, with 27 platform skips on Linux.
The final browser-only frame-readiness adjustment then passed all 9 real-browser scenarios; 130 web tests and the 135-member real-pack audit also passed.
This is separate-lane evidence, not a claim that one final `verify` invocation was entirely green.
Observed environment: Linux x86_64, Node26.7.0, Bun1.3.14, Pi SDK0.84.3 and existing Chrome for Testing151.0.7922.34; root runs used `VITEST_MAX_WORKERS=1` without changing test deadlines.
New coverage includes actual registry-writer and resolver exits, concurrent resolvers, unchanged project fences/history, changed/linked/remote/live resources, a removed stopped workspace, piped/pasted/canceled refusal, genuine native-TTY confirmation and browser Open after explicit recovery without replay.

The first integration command was cut off by its 25-minute outer command budget while tests were still running.
The next completed root run failed one omitted browser-test provenance pin (updated) and three owner/proxy settlement or timeout cases, which passed separately; their timing cause was not established.
A later complete root/web pass encountered Chromium's first screenshot-capture failure; the browser fixture now waits for painted frames before that capture, without retrying operations or swallowing capture errors, and all browser scenarios passed afterward.
The last full attempt hit six history-test deadlines in two files; those unchanged files passed all 45 tests in a subsequent diagnostic run, and the earlier complete root pass remains distinct from that later failure.
Failed logs and isolated fixture evidence were preserved; no test budget was increased, dependency/browser downloaded, consumer lock deleted or service installed/restarted.
No paid-provider use or new native Windows/macOS qualification is claimed.

## Release 2.0.14 acceptance snapshot

Full `verify` passed on the release candidate before this evidence-only note, with `VITEST_MAX_WORKERS=1`: 2000 root tests in 84 files (27 skipped on Linux), 130 web tests, 9 real-browser scenarios and the 135-member real-pack audit.
Observed environment: Linux x86_64, Node26.7.0, Bun1.3.14, Pi SDK0.84.3 and existing Chrome for Testing151.0.7922.34.
Review fixes refuse hard-linked file previews, common credential paths and configured private-directory alias targets; block legacy project Open through the gateway so backend token links and unassociated owners cannot escape its route; and continue serial Stop attempts for other associated owners after an earlier refusal, without releasing uncertain fences.
Each boundary regression was observed failing before its fix and passing afterward; the generated service and browser outputs were rebuilt through their canonical builders.
The first default-concurrency integration run failed 25 tests: 21 timeouts, three state refusals and one stale provenance pin.
The reviewed destination pins were refreshed, the three state-refusal cases passed independently, and the complete single-worker run passed without increasing any deadline or omitting tests; the earlier failures remain failure evidence, not retrospectively successful runs.
No consumer service installation/restart, paid-provider use or new native Windows/macOS qualification is claimed.

## Unified-entry verification snapshot

The unified no-default-workspace change passed full `verify` before this evidence-only note: 1997 root tests in 84 files (27 skipped on Linux), 130 web tests, 9 real-browser scenarios and the 135-member real-pack audit.
New browser cases exercise a real generated workbench and independently opened owners under both loopback and a CA-validated HTTPS proxy: no default directory, same-origin switching, ordinary Send, explicit Create without Start, and retained chat/task navigation after refresh.
The genuine SDK uses an isolated fabricated provider; no paid account, physical device or new native Windows/macOS qualification is implied.
An early browser attempt completed its UI assertions but left one concurrently stopped owner quarantined; its failed closure receipt remains failure evidence, and the gateway now serializes associated owner Stop through their shared registry.
The first full integration attempt then passed root/web checks but hit an existing browser harness's late response-body read; the harness now reads that exact response immediately, without request replay or a larger wait, and the subsequent complete `verify` passed.
No consumer service was installed or restarted, and no existing `~/cadence` or uncertain state was deleted.

## Ordinary-chat workbench integration snapshot

Full `verify` passed on the working tree before this evidence-only note: 1994 root tests in 82 files (27 skipped on Linux), 130 web tests, 7 real-browser scenarios and the 135-member real pack audit.
Observed environment: Linux x86_64, Node26.7.0, Bun1.3.14, Pi SDK0.84.3 and existing Chrome for Testing151.0.7922.34.
The new lane used the genuine SDK against a fabricated loopback provider: ordinary multi-turn restore, a real write tool, duplicate-send observation, directory/credential boundaries, queued cancellation, orderly Stop/restart, rotation while queued, independent project owners/ports, and preserved unaccepted or missing metadata.
Browser coverage includes the ordinary composer, file preview/reference, explicit Cadence creation without Start, retained origin navigation, and settled desktop/390px/320px drawer layouts.
Early attempts caught an optional-envelope decoder regression, late OAuth-settlement tracking during Stop, old package/body counts and worker source pins, plus browser interactions that needed to await modal closure and reference/drawer updates; those were corrected before the final full pass.
No existing budgets were enlarged, no browser/dependency was downloaded, and no consumer service installation, paid-provider or new Windows/macOS qualification is claimed.

## Release 2.0.12 acceptance snapshot

Full `verify` passed on the 2.0.12 release candidate before this evidence-only paragraph: 1983 root tests in 80 files (27 skipped on Linux), 128 web tests, 6 real-browser scenarios and the 132-member pack audit.
Observed environment: Linux x86_64, Node26.7.0, Bun1.3.14, Pi SDK0.84.3 and existing Chrome for Testing151.0.7922.34.
Retained conversations remain readable after their live `task.json` disappears and the owner restarts without a selected model; reads neither reconstruct live state nor grant execution authority, and an unused Start grant from before removal is refused without admission.
Generic stale guidance asks for fresh observation/confirmation without diagnosing a model-source change; local errors no longer hide that observation or suggest starting the service.
The local-error banner regression failed against the prior built assets and passed against the rebuilt candidate; a new Chinese assertion was corrected to expect its translated status, and an initial integration attempt stopped at provenance JSON formatting before the final full pass.
No new Windows/macOS, real service-manager installation or paid-provider qualification is claimed.

## Release 2.0.11 acceptance snapshot

Full `verify` passed on the 2.0.11 release candidate before this evidence-only paragraph: 1976 root tests in 80 files (27 skipped on Linux), 122 web tests, 5 real-browser scenarios and the 132-member pack audit.
Observed environment: Linux x86_64, Node26.7.0, Bun1.3.14, Pi SDK0.84.3 and existing Chrome for Testing151.0.7922.34.
The root Git regressions use real Git with simulated ownership mismatch, and system service management uses isolated filesystem/manager adapters; no real root/systemd installation, new CI matrix, macOS or Windows qualification is claimed.

This release adds explicit directory project launch and independent named Linux system/root services, and a conversation-first WebUI with retained task/run/subagent navigation.
Root observation no longer automatically trusts foreign Git repositories; inactive service definitions cannot stop or adopt detached owners, including through restart or uninstall.
Fast/integration test selection is checked against actual Vitest discovery, and provider prompt failures remain separate from capture failures.
Live task/run/child views reuse only an already observed containing snapshot within one notification drain, never a previous round's action context.

## Release 2.0.10 acceptance snapshot

Full `verify` passed on the 2.0.10 release tree (`4843334` plus the version bump), in the 2.0.3 environment below.
It ran 1949 root tests in 78 files (27 Windows-only controls skipped on Linux), 116 web tests, 5 real-browser scenarios and the 132-member pack audit, and CI 40278386880 passed 12/12 on the candidate `3cd94f4` (this commit before its snapshot).
That CI run's first Windows Node 22 `parallel` attempt failed only `workspace-landing`'s cleanup (EBUSY removing the just-stopped landing workspace), as in 2.0.6's first run; the job passed when rerun.
The fix answers a 2.0.9 report: an Ollama `"apiKey": "ollama"` under a provider named `ollama` made the whole model catalog refuse `unsupported-context`.
An isolated owner with that `models.json` beside a second provider reproduced the refusal on 2.0.9; on 2.0.10 Chromium listed the second provider's models and explained the one withheld entry in English and Chinese.

## Release 2.0.9 acceptance snapshot

Full `verify` passed on the 2.0.9 release tree (`0e720a1` plus the version bump), in the 2.0.3 environment below.
It ran 1948 root tests in 78 files (27 Windows-only controls skipped on Linux), 116 web tests, 5 real-browser scenarios and the 132-member pack audit, and CI 40209338973 passed 12/12 on the candidate `8b53b64` (this commit before its snapshot).
The release adds the Simplified Chinese WebUI; Chromium at 1440 and 390px rendered the shell, inspector, dialogs and timeline in Chinese from a `zh-CN` browser locale.
On the feature tree, an earlier full run failed only the reuse provenance pin (refreshed), and one `accepting-browser` run failed after the second context's Start; that scenario passed in four later runs, and its cause was not identified.

## Release 2.0.8 acceptance snapshot

Full `verify` passed on the 2.0.8 release tree (`7a40be6` plus the version bump), in the 2.0.3 environment below.
It ran 1948 root tests in 78 files (27 Windows-only controls skipped on Linux), 111 web tests, 5 real-browser scenarios and the 132-member pack audit, and CI 40201203720 passed 12/12 on the candidate `1c372b2` (this commit before its snapshot).
The fix answers a 2.0.7 report: `cadence server install` refused existing `.env` files with one message.
The 2.0.7 refusal was reproduced for a 0755 directory from the older `mkdir -p` docs, 0644 editor files, umask 002 and a symlinked `~/.pi`.
Those layouts now install, a dotfiles link stays a link, and a remaining refusal (an `export` line) names its line.

## Release 2.0.7 acceptance snapshot

Full `verify` ran on the 2.0.7 release tree (`7973e23` plus the version bump), in the 2.0.3 environment below.
It passed 1945 root tests in 78 files (27 Windows-only controls skipped on Linux); `service-history-projection`'s multisegment archive test hit its 45s budget under shared load and passed alone (24 tests, 27s).
The 111 web tests, 5 real-browser scenarios and 132-member pack audit passed, and CI 40194654384 passed 12/12 on the candidate `7341cf6` (this commit before its snapshot).
`cadence server install|restart|uninstall` ran end to end in an isolated home, with a fake `systemctl` that runs the unit's own ExecStart and ExecStop.
The printed link entered the WebUI, and an earlier generated-token workspace was reselected to the `.env`.
An edit while running applied only at restart, and rotation changed only the `CADENCE_TOKEN` line.
Real systemd, launchd and Windows registration were not exercised for this release.

## Release 2.0.6 acceptance snapshot

Full `verify` passed on the 2.0.6 release tree (`8d31512` plus the version bump): 1940 root tests in 78 files (27 Windows-only controls skipped on Linux), 111 web tests, 5 real-browser scenarios and the 132-member pack audit, in the 2.0.3 environment below.
The package ships no install script: in isolated global installs, Bun 1.3.14 blocked three scripts for 2.0.5 (Cadence's postinstall and the Pi SDK's `@google/genai` and `protobufjs` scripts) and only those two SDK scripts for 2.0.6, and npm 11 lists only them.

## Release 2.0.5 acceptance snapshot

Full `verify` passed on the 2.0.5 release tree (`dce261b` plus the version bump): 1940 root tests in 78 files (27 Windows-only controls skipped on Linux), 111 web tests, 5 real-browser scenarios and the 133-member pack audit, in the 2.0.3 environment below.
On that host `cadence server status` read the live unit that 2.0.4's Pi install hook had registered as `active` and `enabled` with linger on, so earlier units stay manageable.
The launchd and Windows Run backends ran only against injected launchctl, reg.exe and orderly-Stop fakes; real macOS and Windows registration remains unqualified.

## Release 2.0.4 acceptance snapshot

Full `verify` passed on `3987f65` (the `max` thinking change): 1925 root tests in 78 files, 111 web tests, 5 real-browser scenarios and the 132-member pack audit, in the 2.0.3 environment below.
On the same host, against a real Pi 1.4.0 user-scope install and a user-configured OpenAI-compatible provider, an owner model chosen in the WebUI ran a readonly research Start end to end: the child used `ls`/`find`/`read`, settled `completed`, published its summary and recorded hidden thinking as omitted.
A concurrent Pi TUI's agent panel followed that child from launch through its tool calls to `finished (ok=1)`.
A DeepSeek model whose `thinkingLevelMap` maps only `max` became selectable at `max` and its child made tool calls at that level; editing `models.json` during that run turned the owner's views `stale` until restart, as now documented.

## Release 2.0.3 acceptance snapshot

Full `verify` passed on `c27b8ca`: 1924 root tests in 78 files (27 Windows-only controls skipped on Linux), 111 web tests in 8 files, 5 real-browser scenarios in 3 files and the 132-member real pack audit.
Observed environment: Linux x86_64, official Node 22.22.1, Bun 1.3.14, the pinned Pi SDK 0.84.3 and Chrome for Testing 153.0.8010.12; later commits change only tests and this section.
The GitHub matrix (Windows and Ubuntu × Node 22/24 × `parallel`, `serial-process`, `serial-scan`) runs on the separate CI branch.
A real Pi 1.4.0 user-scope install of the packed candidate, installed into Pi's own npm layout, registered and enabled the unit, enabled linger without a prompt and, on upgrade, stopped the old owner in order before starting the new one.
That owner started with the agent directory Pi had created at 0775 and served the built WebUI to Chromium at 1440, 390 and 320px widths.
No model-backed task ran there (no Pi provider login); macOS, physical phones, paid accounts and every adapter, and a second machine remain unqualified.

## Prior integrated acceptance snapshot

Before removal of development-workflow tooling, the integrated redesign passed full `verify`:1839 root tests/69 files,110 web tests/8 files and5 real-browser scenarios/3 files, with27 existing Windows-only controls skipped on Linux.
It also passed separate129-member/35-runtime-source real pack/extraction, all four source/extracted regular/fullscreen Pi PTYs, mixed clients, CA-validated HTTPS/WSS, plain/gzip OAuth proxy, informed recovery and complete retained-history exports.
Observed environment: Linux x86_64, Node26.7.0, Bun1.3.14, Pi0.84.3 and Chromium151.0.7922.34.
These are prior executed results, not a claim that every later edit or other environment has been tested.
The implementation/docs/evidence checkpoints are Git commits `b0fde94`, `531b158` and `2fd28b0`; historical failed/unknown outcomes are not rewritten by this summary.
Additional Windows/macOS/ConPTY, Node22/other peers, paid accounts/every adapter, physical phone/human/second-machine, package-manager installation and real deployment remain unqualified.
