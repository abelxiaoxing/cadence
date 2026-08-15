---
description: Diagnose and minimally repair one or more existing bugs
argument-hint: "<problem-description>"
---

Load the bundled `abel-workflow` Skill before doing any work.
Read the complete value inside `<abel-request>` without a second whitespace-tokenization pass.

<abel-request>
$ARGUMENTS
</abel-request>

The request must uniquely identify one or more existing bugs.
If required input is missing or ambiguous, stop and ask for the missing or disambiguating information instead of guessing.

## Diagnose procedure

Record target, affected-suite, and full-suite baselines before writes, keeping pre-existing failures separate from the reported defect.
Collect evidence for each report, reproduce it, propose candidate root causes, and actively falsify each candidate before accepting a root cause.
If the defect cannot be reproduced or the root cause remains unverified, mark it blocked and do not generate a repair.

For each verified root cause, first add and run an executable regression verification that fails for the target defect.
Only then apply the minimum repair, rerunning the target after every code or test edit and the affected suite after refactoring.
At a stable checkpoint, classify AGENTS impact, apply only verified managed-index changes, and validate routes.
Finish only when regression and affected verification pass and the full suite has no new failure relative to baseline.

If resolution requires new behavior, substantive architecture, or a choice not uniquely determined by an existing contract, stop and return the requirement to Design.
Do not archive, publish, or commit implicitly.

If the required input is missing or absent, or the request is ambiguous and not unique, stop before any work and ask the user for the missing or clarified input.

Reproduce and falsify the root cause first: complete the failing regression verification before the minimum repair.
The fix must not introduce new behavior or architecture; a substantive decision returns to Design.
When dev-browser is missing or unavailable, block only approved browser E2E tasks, must not block other work, and provide executable remediation.
