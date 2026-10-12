# Backend Development Guidelines

## Approved lightweight replacement

[Lightweight Workflow Assistant](../backend/lightweight-workflow-guidelines.md) is the current user-approved target.
It supersedes incompatible certified-executor/transaction-application/whole-resource-proof requirements below.
Implementation and independent qualification are in progress; historical failures are not new passes.
Keep old consumer data untouched and retain useful consent/privacy/process/data/package behavior without importing the retired machinery.

## Current G6 source contract

[Application Authority and Readiness](./task-application-readiness-guidelines.md) owns the approved A+B+C application cuts, immutable declarations, own-key copy semantics and unchanged strict transaction/native input checks.

The unreleased sole production composition is the terminal-only task completion shell.
Earlier disconnected/stage/Gate checkpoints below remain historical and do not authorize release.
[Task Distribution and Retirement](../backend/task-distribution-guidelines.md) owns the current shipped surface, safety preservation and local-versus-release gates.
[Completion Publication Admission](./task-publication-admission-guidelines.md) owns the approved supported-private-writer exclusion, live/current-row file cuts and full entry/recovery/ack audits.
[Task Read Snapshot Boundaries](./task-read-snapshot-guidelines.md) owns the approved original-readonly one-shot S/G consolidation, distinct checks, strict-route exclusions and duplicate-only native-fault tradeoff.
[Original Execution Reader Admission](./task-execution-admission-guidelines.md) owns the approved G4 static/live/input separation, captured selection ownership, named no-effect/materialization cuts and unchanged strict/application routes.

> Guidelines for the Cadence package code: the `src/` TypeScript modules, owner-private SQLite storage, the Design/Implement workflow engine, delivery, verification, and operator tooling.

---

## Overview

This directory covers the backend layer of `@abelxiaoxing/cadence`, the single Bun/TypeScript package that ships as a Pi extension.
There is no web server, database server, or REST API: "backend" here means the durable, owner-private control plane the extension runs inside the Pi process and on disk.
The layer spans the `src/` modules (activation, Design, Implement, delivery, verification, storage, operators), the maintenance `scripts/`, and the `test/` suite that verifies them.
The matching Presentation & Content layer (TUI projection plus prompt/skill/agent/config content) lives in `.trellis/spec/frontend/`.

---

## Guidelines Index

| Guide                                           | Description                                                              | Status |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| [Directory Structure](./directory-structure.md) | Top-level layout, module ownership by domain, generated modules          | Done   |
| [Database Guidelines](./database-guidelines.md) | Owner-private SQLite storage, checked schemas, additive migrations       | Done   |
| [Task Storage](./task-storage-guidelines.md)    | Disconnected G2 contracts, migration, compound facts and read boundaries | Done   |
| [Error Handling](./error-handling.md)           | Fail-closed patterns and bounded diagnostic vocabulary                   | Done   |
| [Quality Guidelines](./quality-guidelines.md)   | Standalone commands, CI matrix, distribution rules, testing discipline   | Done   |
| [Logging Guidelines](./logging-guidelines.md)   | Bounded secret-free diagnostics instead of free-form logging             | Done   |

---

Disconnected G3 building blocks: [Task Execution Compiler](./task-plan-guidelines.md) covers the shared neutral core and static occurrence/effect/scope semantics, not complete admission or execution authority.

Disconnected G3 authority: [Task Execution Authority](./task-execution-guidelines.md) covers checked immutable revisions, finite derivations and fresh launch checks.
The disconnected native provider now joins checked independent application evidence; G3/G4 acceptance remains pending process/shell/integration gates.
The execution guide also covers disconnected G4 neutral-core/business-domain prerequisites, not itself a task-native engine or foreground permission.
Its later scenarios cover the disconnected native scheduler and narrow checked apply/result slice.

Disconnected readonly A: [Task Observation](./task-observation-guidelines.md) covers minimized status, bounded filesystem reads and resource closure; production remains disconnected.

[Authoring: accepted B; checked C, gates pending](./task-authoring-guidelines.md).

## How to Use These Guidelines

Each file documents the actual conventions of this package, with real file paths and concrete examples taken from the code.
Read the file matching the layer you are touching before writing code, and prefer the existing module that already owns the concern over a new abstraction.
Changes to storage schemas, failure codes, or verification adapters have cross-module effects; search for the identifier before editing it.

---

**Language**: All documentation should be written in **English**.
