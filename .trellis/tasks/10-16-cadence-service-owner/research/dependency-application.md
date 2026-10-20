# W1 dependency application

## Applied boundary

Applied the reviewed 26 direct additions (ws only in production), the exact standard-generated Bun lock, and the separately approved Node metadata `>=22.19.0`.
No scripts, description, bin, Pi pins/public peers, unrelated manifest fields, package-member policy or generated executable changed.
This is dependency preparation, not W1/product/runtime/package qualification.

[Invocation receipt](dependency-application.receipt.json) binds the actual command, clean environment, pre/post inputs, outputs and preserved helpers/preimages.
Its SHA-256 is `2381063377765b9d6926f5bda7f54b491ee5f312598a986e8ab71fd742d3612a`.
The new owned evidence root is `/tmp/cadence-w1-apply-yb6pics9`; the reviewed provisioning root remains untouched at `/tmp/cadence-w1-provision-ar5oshfh`.

## Before application and invocation

Fresh comparisons succeeded against both original repository inputs and the selected fixture:

```text
original package.json 160338264368de80721ca59cf7574355f758ee1cfb1fd7ad6f78b43134811b5d
original bun.lock     bab6352115eb8c11edce70010dd5720553c650418c0a3a26a7fbe245ea8f1d50
fixture package.json  dec6786ac1c7d05c64326d8d6610628af7bb87693c1e383dedd932b353a28d76
fixture bun.lock      cc31e7ad885c21849b38515cb47bb9913b75801a3b484bf647e11fe354f47551
```

The application helper compared parsed objects, proved the fixture equals the original plus exactly 26 edges, then applied that delta and the approved engine field.
It copied the reviewed lock without editing it.
Original package/lock bytes are retained under the new root as `pre-package.json` and `pre-bun.lock`.
All frozen shared-source hashes were also compared before application and remain unchanged.

Before Bun ran, a fresh inert comparison verified **393 cache packages / 21,650 files** against the provisioned tar bodies, including no additional regular files.
The three reviewed nonhost tarball-only cache gaps remain unchanged; no unsupported-platform installation is claimed.
A separately timestamped **post-install** supplemental check revalidated all **403 compressed artifact SHA-256/SHA-512 bindings and 17 supporting evidence files** against the unchanged approved provisioning receipt.
Do not mislabel that supplemental compression check as a pre-execution capture.

## Actual installation

The actual root-project inputs and ignored project `node_modules` were mounted at `/work` in Bubblewrap.
No checkout-wide or personal-home/config mount was provided.
Only `node_modules` and the new owned evidence/temp root were writable; the reviewed Bun cache and package/lock mounts were readonly.
A fresh empty HOME/XDG/config/temp environment was supplied; npm user/global config and Bun config files were empty.
No ambient environment merge, proxy/provider/npm credential, personal browser profile or global package fallback was used.

The enforced route was `bwrap --unshare-net` followed by:

```text
/usr/bin/bun install --frozen-lockfile --ignore-scripts --backend=copyfile
  --prefer-offline --cache-dir=/tmp/cadence-w1-provision-ar5oshfh/bun-cache
  --config=/tmp/cadence-w1-apply-yb6pics9/config/bunfig.toml --no-progress
```

The same invocation recorded its actual network namespace and empty route table before exec.
Its namespace differed from the parent; `--prefer-offline` was not treated as isolation.
Bun exited **0**, reporting **175 packages installed** into the existing project installation.
This is different from the earlier clean-fixture 342-package install, not a replacement claim for it.
No downloaded lifecycle hook or automatic browser download ran; no prebuilt temporary `node_modules` was copied back.
There was no failed attempt or online fallback in this application pass.
Earlier provisioning failures remain untouched.

The invocation receipt records these hashes both **before spawn and after exit**, addressing the earlier provisioning receipt limitation:

```text
package.json 2aa7fe4c464835cdebdafbed2cf5d4831cc02c753886eb6f0b42041c46f7464c
bun.lock     cc31e7ad885c21849b38515cb47bb9913b75801a3b484bf647e11fe354f47551
```

Tools: `/usr/bin/node` **26.7.0**, `/usr/bin/bun --version` **1.3.14**; Bun's install banner separately reports **1.3.14-canary.1 (0d9b296a)**; Bubblewrap **0.11.2**, Linux/x86_64.
Pi coding-agent/AI/TUI/agent-core remain **0.84.3**.
Engine metadata does not establish Node22 or nonhost runtime qualification.

## Remaining gates

Existing repository build/check/test tools were invoked only after this dependency setup; their scoped results are in [the owner-core handoff](w1-owner-core-handoff.md).
No service/SDK/provider/browser deployment, real credentials, package-manager consumer install, pack audit or emitted-asset/license qualification follows from this installation.
W6/W7 still own actual asset/reference/vendor/font notice closure and distribution qualification.
Do not update historical failures or weaken the exact archive policy to accommodate these new package edges.
