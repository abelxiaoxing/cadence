# G6 archive live-reference transition

## Boundary and current references

G6 was already legitimately archived after the independent eight-criterion pre-archive review; this repair did not rerun or undo archival.
Actual destination: `.trellis/tasks/archive/2026-10/10-06-cadence-retirement-distribution-qualification`.
Original Trellis archive PID541581 returned exit0 with `--no-commit`; only its reviewed task.json completion fields changed during that move.
This repair changed exactly19 existing live files: one CI command line, one exact format-only Biome path and17 specs/31 literal link targets.
Every spec/Biome change is exactly the old literal prefix replaced by the archive prefix; CI instead names the new stable-parent map.
No prose, assertions, budgets, dependencies, runtime APIs or task metadata were changed.

[Current CI map](./g6-ci-current-map.json) is a NEW reference-only copy of the [sealed original CI map](../../archive/2026-10/10-06-cadence-retirement-distribution-qualification/research/acceptance-map-ci.json).
Only actual PRD/check-path/input-path prefixes were translated; all19 IDs, assertions, input sets, empty evidence and original planned/unavailable statuses remain.
CI runs `bun run traceability:check --map .trellis/tasks/09-23-cadence-harness-redesign/research/g6-ci-current-map.json` without `--require-passed`.
Pointing CI directly at the archived original would fail: its historical internal paths intentionally remain unchanged.
This reference gate is not eight-criterion release PASS and does not alter the production contract.

## Body custody and hashes

Fresh no-follow comparison matches all290 archived regular bodies and five subdirectories against move-after, including completed task.json, with exact modes/UID/GID and recorded filesystem identities.
Qualification222 classify as40 same-body relocations,19 exact live-reference substitutions and163 unchanged paths/bodies; task.json is outside222.
All34 shipped bodies,16 source owners and three Agent provenance pins remain byte-identical to the source51 baseline.
Worker SHA256 remains `12fff81671cc0bd1d3011f43f9364531bba0a08007dd1abe728de00a676022f3`.
Parent/sibling task metadata remain unchanged; the supplied active pointer stays None, without inspecting session stores.
No old-path refill, shim, alias, archived-map/manifest rewrite or private-seal rewrite was made.
The immutable [pre-archive map](./g6-before-archive-qualified-map.json) remains499214 bytes, SHA256 `bdfc7bd35b6a8ccb3920dce6b21a71e533cb1ca49e7917f2a33144b5d86408f8`; it is intentionally not a current post-archive map.

- Original CI map SHA256: `d9f31b29df2e49fda17d27b0ae3f7845bb7d365e5b3ee991363728c051c4edf3`.
- New CI map SHA256: `dd03708e156f19d29316bfe13427a1b2a7aae83b7257a75a85b6a32312660598`.
- `newMetadataHash`: `39efc538f9d3ce5542e505bba1ffc908f6a18b5a3ad02f7413b59e0cd3f7b0e5`.
The metadata hash binds a path-sorted19-live-plus-new-map list of `{path,sha256}`, serialized as compact UTF-8 JSON with sorted object keys; handoff/private receipts are excluded.

Existing live files, old SHA256 → new SHA256:

- `.github/workflows/ci.yml`: `0cfc1b108ab05d289cbbadc8a1ec209bf251a6884c19fc48adc9d3e04e5f889f` → `06f8ba90e07bd1347fa4cdf2db0f2a94aed6b151e3f3f68d53d6d4e1ac5ee348`.
- `.trellis/spec/backend/index.md`: `46681972bafcd09e0b6088b821261800c903af7f132c328cdb73e83e4d34846f` → `da27e70a1788dc1e78848c4fb74cf640b03f8a8ce65509de5d137b82e44cc77e`.
- `.trellis/spec/backend/lightweight-workflow-guidelines.md`: `b753f991975284a1e0b8ac6782d811f6df609cdcabc3840bafd5bfbdfd0d0633` → `71e9c16b68c63af2624cc02ec561007fe28c3c7c406936fc53e5ffc899784325`.
- `.trellis/spec/backend/quality-guidelines.md`: `e54f1fd839885f06ee15f288777141defbfe8a616c41f3ee032ee1e2ecea6da7` → `27d976f7cb8cac8161756578977408e2ff86f3cdb5d0ddf5866a0f241d516fd8`.
- `.trellis/spec/backend/task-application-readiness-guidelines.md`: `f7a4f0376fa756492d436766741662f6f48800d7bce16a390cd270d2bab532ff` → `cc5e7be1e8f646443be4382169c0624aea74ccaa176e065f05aaff506a36776f`.
- `.trellis/spec/backend/task-authoring-guidelines.md`: `aa433f3c9101dc73041c3e899ca2b7ace6c96658ceb75a0135c50c48b59422ba` → `90e07a9ca26d0d44634af3cfdd84ee53e64929dada1f4bf6d7459635423445c3`.
- `.trellis/spec/backend/task-distribution-guidelines.md`: `c3e108ff94fa232ee3942f479f33d8fa72e685062c998ec3d3c2dd2f32b20ab8` → `9defcb6ae0b013a1357f81a64800b585d45df6dbf424d8c83d7d9aa39b693bc3`.
- `.trellis/spec/backend/task-execution-admission-guidelines.md`: `ce0fed31264b2b8419fa41bcd6568047dda74002b29b20742a9fd4d3a09cd8f7` → `89c75be022ad4b7e5a9fe774ce754150c8c0251de0ebc1f79cbeee573e0fe57e`.
- `.trellis/spec/backend/task-execution-guidelines.md`: `f27ce70a0c52fc9c90e1878dfc6be71a434d0a7db43a08149b8d672490c4fc12` → `ed9b363660dc5af7a3428b17a2c93f4788b45cf6436f2c70e5ee0b2e01d29542`.
- `.trellis/spec/backend/task-observation-guidelines.md`: `4243117c4fd661b6f3811995b84538a7f530a6e900916ee426ce87a3778a524c` → `6a816038fa8e22f8a881bde0d33052b284b6a32f3b640632e1a2eebc46cb9b0c`.
- `.trellis/spec/backend/task-plan-guidelines.md`: `f0d0263d08c5cfb8c2cc13b63d3e0d38875b43636b96617c7d5e893265e4a724` → `0e7d7de90fe8e8e77aa4b099a3c67b8e28b73b458f411a4a6bd183f31139cfe2`.
- `.trellis/spec/backend/task-publication-admission-guidelines.md`: `6cce4062cfe0897b70b9e2b409bb21981433f9ce42c08a5ffb491dbc24f85b57` → `58799f6d4ce3efab04b260bd3e30785fc0c49aafaa985286c880843ad140761a`.
- `.trellis/spec/backend/task-read-snapshot-guidelines.md`: `162ddb236ca47976fd7144a3675dbf5fee43129b9a71f26702a8928129f8ac42` → `67b4fb56d3972ad04ec5160eec94fd003bcc54df214beb42973f94957e3ab18b`.
- `.trellis/spec/backend/task-storage-guidelines.md`: `93ebf278ebb1e323f662a8201129a24d27fa5b5024401112b8bd5b3603f2129e` → `fbbf7a77fd5cdbcf2d1bddb2237e4431ede503ea1aa337888d8b03ba25b9d5b1`.
- `.trellis/spec/frontend/quality-guidelines.md`: `a09568bdc06888ced469ea0b3c17d545ed84adb5a8727f54722c9994495a40fb` → `78dad382df77eb861cc13699fe2a9c191b7617b1f9cda4c24ada7283dc591476`.
- `.trellis/spec/frontend/task-planning-guidelines.md`: `9b7bf903b0ecef3839949f576a2d42425d53b8619f91ccf78ae8f472149a7e15` → `abdb5dfcf5a4f86400e90be347b2b20819a39c05a9c6bfd6b91a18960575afaf`.
- `.trellis/spec/frontend/task-session-guidelines.md`: `7cd315eac5a07c838dcd351d9ed33471ca1347495519a1f46c9cbc6c4a06e580` → `ab0a275af5347f2250424ec2deff0d1eed3b4a05d35d8a43a577c8fb2e209989`.
- `.trellis/spec/frontend/task-source-guidelines.md`: `c50d8c343a90199bf41129e3e2186debe7bfc0b983ef897f12d189935dc926d5` → `0ecadbf401ac1595dc3181dbcfe1a2edbd1586079be90d64f43a950243335ecb`.
- `biome.json`: `917e6e7db041f9ee5020454b9ebdf4fff37d41355a89363e65bb75e4f6e43c4c` → `b1bce018ba63b2b5f7fc7122f8a51205cec3973cc2a344b194ee35dc7e9c4d05`.

## Scoped verification and retained receipts

Actual sterile Linux x64 Node26.7.0/Bun1.3.14 syntax validation and the new CI reference gate returned original exit0; the latter reports8 criteria/19 checks, not execution/release evidence.
Scoped Biome returned exit0: three JSON files checked, no fixes; supplied Markdown/YAML paths have no supported checker and are not claimed linted by Biome.
Original waits, closed stdout/stderr, exact per-file substitutions/new targets and final scoped Markdown/live-href results are retained in the owned private receipt/index.
No product/scoped command first failure was repaired or discarded; the expected no-match search exit1 is not a failure.

Private owned0700 root (files0600):

```text
/home/mirako/.local/state/cadence-release-qualification/744e5f0de9223044/qualification-7db986a-c8cef218/repair-final-bk0d8kjm/commit-push-audit/ci-round2-authenticated-cb9a5079/g6-reference-transition-rwr3l00c
```

`reference-transition-receipt.json` SHA256: `deb47ef4a86ac182abca347a5fcc30acd5b7cf1c3ca14bfbbe783123fe5d8099`.
`index.json` binds final Markdown/link checks, unchanged-state recheck and this handoff without rewriting the receipt.
Original move receipt SHA256: `15521982d351fb236a9bbe3874ec1b3624b59d589315fa598b50ef139dee77f0`.
Original move-before/move-after SHA256: `b62e198e996c41a94840279621dbebb94b4179693bf564a7f0a49f96f97424d4` / `4df66ce5a008cfd29d7cddf66aca336ce566571c5d95ac915b97d958c4ea4439`.

## Separate remaining qualification

No whole test/verify/pack/operator/pin execution, installation, new native CI, normal model/auth request, paid/native Start, Git/index operation or subagent ran here.
Later whole/operator/pin gates, actual new Linux/macOS/Windows CI and an independently reviewed post-archive metadata bridge remain separate responsibilities.
No `g6-after-archive-qualified-map.json` was created; historical source/native/install/real executions were not relabeled as tests of changed metadata.
The legitimate pre-archive semantic result remains historical; missing438-preimage debt, historical failed evidence and optional physical-human unavailability are not repaired by this transition.
