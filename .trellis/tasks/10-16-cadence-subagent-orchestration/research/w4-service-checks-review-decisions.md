# Focused check review corrections

The actual running-shell rotation counterexample failed: new and intermediate rotated tokens were present in retained output.
Original native exit was zero; the test used fabricated private roots, not user credentials.
Preserve its receipt.

The correction belongs at the owner check recorder, not the child environment: use the existing AccessMaterial revocation notification and private literal reads.
Refresh before decoding ingress and final tails, synchronously observe every rotation while recording, and merge literals into the existing TextSanitizer without clearing pending UTF-8/literal/heuristic prefixes.
Retain old literals only for this bounded recording lifetime; the existing 256KiB sanitizer literal bound also caps the union.
Refuse capture on source uncertainty/capacity, never forget retired literals, retry auth, or pass secrets to the native child.
Unsubscribe on end/failure and preserve original storage/native accounting.
No public codec or provider subsystem changes.
Selected model sources remain strict readonly snapshots; unobserved external credential refresh/replacement refuses rather than getAuth.

Charge both literal sets, pending prefixes, decoder tails and terminal/heuristic states before allocation; also charge final-tail transformation, not only ingress.
Keep existing raw/detail/queue/disk/time ceilings.
Labels in combined output are presentation only and can also occur in untrusted command output; tests must not use them as authoritative framing for arbitrary source bytes.

Expected files: check-recording, scheduler/task-actions private callback wiring, shared sanitizer/declaration additive literal merge, focused tests, regenerated service outputs and current provenance only if its source changes.
No accepting host, renderer, task-status/spec, dependency, recovery or human-review work.
