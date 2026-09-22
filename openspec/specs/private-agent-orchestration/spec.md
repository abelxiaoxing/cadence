# private-agent-orchestration Specification

## Purpose

Cadence owns the Abel workflow boundary and durable parent control plane while delegating bounded one-shot work to package-owned Pi child processes.

## Requirements

### Requirement: Stage-bound dispatch

`abel_dispatch` SHALL be available only after validated Abel stage activation. Ordinary conversation and an unverified prompt SHALL not gain worker authority.

### Requirement: Single-source worker roles

Design, Implement, and Diagnose SHALL use the package-owned role definitions and a code-owned capability profile. The child SHALL receive only the role's allowlisted built-in tools; Implement writes SHALL occur only in a disposable proposal workspace.

### Requirement: Lightweight child result

A child SHALL return one final assistant text/result. Cadence SHALL adapt only the minimum evidence fields needed by the parent workflow. The child SHALL NOT use a Cadence submit tool, durable submission session, repeated submission protocol, route identity binding, or provider-specific adapter.

### Requirement: Parent authority and durability

The parent SHALL own packet activation, cancellation, workspace materialization, approved write/delete boundaries, candidate sealing, verification, recovery, and durable workflow state. Child disposal, process replacement, or host-session replacement SHALL NOT invalidate committed parent facts.

### Requirement: Process safety

Every child SHALL have an explicit tool allowlist, bounded prompt/output and execution time, cancellation propagation with termination escalation, and recursion protection. Failure, cancellation, timeout, malformed output, and out-of-bound changes SHALL remain non-success outcomes.

### Requirement: Basic progress

The parent SHALL project queued, running, completed, failed, cancelled, and timed-out lifecycle states to the existing activity presentation without exposing raw child output or secrets.
