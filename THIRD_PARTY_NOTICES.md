# Third-Party Notices

This package adapts narrow lifecycle evidence from the reviewed reference repository `gotgenes/pi-packages` (MIT), commit `a1ee2255b81cb540f88d233112e868ca91fe7846`, package `packages/pi-subagents`.
Only FIFO settlement, cancellation cleanup, legal state transitions, and born-complete session disposal invariants informed this implementation.
The adapted invariants are re-expressed in this package's own code and tests; no reference code is shipped verbatim.

The complete MIT license text of the referenced package is bundled at `licenses/pi-subagents-MIT.txt`.

| Adapted concept                                 | Reference source                | Reference path                                |
| ----------------------------------------------- | ------------------------------- | --------------------------------------------- |
| FIFO settlement of queued work                  | gotgenes/pi-packages @ a1ee2255 | packages/pi-subagents (state/queue semantics) |
| Cancellation cleanup and born-complete disposal | gotgenes/pi-packages @ a1ee2255 | packages/pi-subagents (session lifecycle)     |
