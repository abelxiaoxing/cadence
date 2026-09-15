# Host execution prototype preparation

Stage-one prototype preparation is complete; native qualification pending.
No production `host-trusted` mode is enabled.
Existing `isolated` and `local-trusted` behavior, Linux Bubblewrap, storage, recovery, verification identity and apply remain unchanged.
These scripts are not a security sandbox and are not included in the package tarball.
No install hook, runtime compiler, download or new dependency is added.

## Local preparation checks

Run from the package root:

```sh
bun run test:target test/host-prototype-build.test.ts test/host-prototype-harness.test.ts test/host-prototype-ci.test.ts
bun run verify
bun run traceability:check
```

The targeted tests validate actual JavaScript request, build-plan, manifest and result rejection logic, controlled lifecycle observations, intended C API ordering and CI structure.
Source assertions and unit observations do not establish native containment.
Each preparation task has a named missing-product Red assertion.
Neither importing modules nor running the ordinary test suite compiles a helper or invokes native qualification.

## Explicit Windows build

Use Windows x64 with an installed Visual Studio 2022 x64 developer environment (MSVC 19.3x/19.4x and Windows 10 SDK).
Select the tools explicitly using the installed `VsDevCmd.bat -arch=x64 -host_arch=x64`, then run:

```sh
node scripts/host-prototype/build.mjs --output C:\explicit\host-prototype
node scripts/host-prototype/qualify.mjs --require-native --output C:\explicit\host-prototype --helper C:\explicit\host-prototype\windows-launcher.exe
```

The shell-free build resolves `cl.exe` from `VCToolsInstallDir`, records compiler version and hash plus `WindowsSDKVersion`, and writes a manifest only after a successful bounded compilation.
Qualification checks the x64 PE header, helper hash, current C/protocol hashes and recipe version.
Unsupported platforms, architectures, compiler versions and missing/tampered assets fail nonzero.
Binaries are explicit CI build artifacts, never text/Base64 submissions from a Worker.

The experimental launcher creates a non-breakaway, kill-on-close Job and completion port, starts the target suspended, assigns it, then resumes.
Only target output and null input handles are inherited.
The controlling Job handle is private.
Assignment failure terminates the suspended process before fixture instructions run.
A controlled `--assignment-failure` fault closes the Job before the actual assignment API; it tests this failure branch, not every possible host Job policy.

## Wire and lifecycle contract

`protocol.mjs` validates a closed version-1 request: absolute executable, argv, cwd, explicit environment, execution/shutdown deadlines and output limit.
Mounts, unknown fields, NUL/unpaired surrogates, oversized inputs, relative paths and case-insensitive duplicate Windows environment keys are rejected.
Windows paths use drive-rooted paths; UNC/device paths are outside this prototype contract.

The Windows wire has nine little-endian uint32 fields: version, timeout in ms, shutdown in ms, output-byte limit, four UTF-16LE byte lengths, and zero reserved.
The four following buffers contain executable, CRT-quoted command line, cwd (each NUL-terminated), and a sorted double-NUL environment block.
Total input is bounded to 64 KiB.
CRT quoting preserves spaces, quotes, empty arguments and trailing backslashes.
Remaining stdin is control: any byte or EOF cancels. macOS uses one bounded JSON request line, then the same cancellation convention.
Output uses bounded JSON lines with hex-encoded fixture bytes and one distinct final lifecycle observation.
Environment values are never included in reports.

Root exit, managed settlement, descendants reaped in the declared scope and termination uncertainty are separate facts.
Expected cancellation, timeout and launch-failure fixture outcomes are lifecycle test results; they are never a product Red verdict.
Any unexpected failure or uncertainty prevents qualification.

## macOS preparation and limitations

Run on native macOS x64 or arm64:

```sh
node scripts/host-prototype/qualify.mjs --require-native --output /explicit/host-prototype
```

The supervisor creates a separate process group.
An independent EOF monitor survives supervisor loss, observes root/group settlement and applies bounded TERM then KILL escalation.
Deliberate `setsid`, daemonization and other group escape are unsupported; killing a helper is not an arbitrary descendant-cleanup guarantee.
The fixture-PID observations are local to generated temporary roots during this invocation.
They are not durable ownership identities and cannot authorize recovery or cleanup of user runs after reopen.
Cleanup uncertainty fails the invocation and retains the fixture root for investigation.

## Native qualification and CI handoff

The native entrypoint requires actual Node 22.13.0 or 24.13.0, Windows x64 or macOS x64/arm64, and on Windows a matching built helper.
There is no public fake-platform or injected-process CLI.
It runs assignment failure (Windows), root exit with a remaining descendant, output/witness streaming and limits, cancel/timeout, control loss, helper failure, Unicode/spaced executable/cwd/argv and explicit environment cases.
Only successful actual cases produce `qualified.json`; a rerun removes an old success marker before capability checks.
`diagnostics.json` records available case outcomes on failure.
Logs do not print credential environment values.

Reports bind OS build, architecture, Node version/binary hash, commit and all prototype source hashes, plus the Windows compiler/SDK/helper manifest.
A helper failure case independently observes disappearance of the generated fixture's two processes; it does not establish an arbitrary descendant receipt.
A digest or JSON assertion alone does not confer approval: review actual CI run provenance and bytes.

The additive CI job uses `windows-2022`, `macos-15-intel` and `macos-15` (arm64), asserts actual platform/architecture/Node, and records tool versions.
Hosted image labels are not immutable images; unavailable labels/tools fail rather than silently substituting architecture.
Repository permissions remain read-only, no secrets are requested, diagnostics upload preserves failure status, and artifacts expire after seven days.
Creating this configuration is not evidence that any native lane ran.

Before stage two, run and review all six native lanes.
Production integration still requires an explicitly approved delivery, native packaged Red/Green, reopen, cumulative verification and apply acceptance, environment/identity binding and compatible state admission.
No production support, user-run recovery, publication or release is claimed by this preparation delivery.
