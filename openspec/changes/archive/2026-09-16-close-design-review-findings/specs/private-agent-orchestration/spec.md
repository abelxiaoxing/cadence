## ADDED Requirements

### Requirement: Verification environment identity

Verification SHALL bind installed dependency bytes and runner identity in addition to repository inputs. Identity collection SHALL be bounded, cancellable and outside the parent event loop for dependency trees. A changed environment SHALL invalidate retained baseline and phase-policy evidence; unavailable or drifting environments SHALL not supply product failure evidence. Disposable tool caches SHALL not change identity.

#### Scenario: Installed runner or dependency changes

- **WHEN** installed executable or transitive dependency bytes change without changing the lockfile
- **THEN** currentness fails and old verification evidence cannot be reused as current

#### Scenario: A run resumes in a different environment

- **WHEN** a retained run reopens with a changed installed environment
- **THEN** it rebuilds the baseline and revalidates retained phases while reusing compatible sealed candidates

#### Scenario: Final application resumes after environment drift

- **WHEN** final apply is interrupted and its host reopens with a different verification environment
- **THEN** the retained transaction rejects old evidence, safely rolls back and allows a later resume to revalidate before a new application
