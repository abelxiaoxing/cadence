# Presentation & Content Guidelines

## Approved lightweight replacement

[Lightweight Workflow Assistant](../backend/lightweight-workflow-guidelines.md) is the current user-approved target.
It supersedes incompatible certified-executor/transaction-application/whole-resource-proof requirements below.
Implementation and independent qualification are in progress; historical failures are not new passes.
Keep old consumer data untouched and retain useful consent/privacy/process/data/package behavior without importing the retired machinery.

## Current G6 source contract

The unreleased sole production composition is the terminal-only task completion shell.
Earlier disconnected/stage/Gate checkpoints below remain historical and do not authorize release.
[Task Distribution and Retirement](../backend/task-distribution-guidelines.md) owns the current shipped surface, safety preservation and local-versus-release gates.
[Original Execution Reader Admission](../backend/task-execution-admission-guidelines.md) keeps foreground approval and effect-boundary inputs distinct from no-effect scheduler/materialization checks; it does not add a UI permission route.

> This repository has no web frontend.
> This layer covers the Cadence TUI presentation (the subagent-activity widget and the startup card in `src/subagent-activity.ts` / `src/startup-card.ts`) plus the package-shipped content: the skills in `skills/`, the three professional Agents in `agents/`, and the example configuration in `config/`.

---

## Overview

The "frontend" of this package is a terminal presentation surface and a set of versioned, pinned content assets — there is no browser code, no component library, and no server-rendered page.
The package renders through `pi-tui` widgets inside the Pi session, and everything the user can read that is not a tool result (activity lines, the configuration card, the skill documentation) is owned by this layer.
The package code itself (storage, workflow engine, delivery, verification, operators) is documented in `.trellis/spec/backend/`.

---

## Guidelines Index

| Guide                                             | Description                                                                                         | Status |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| [Directory Structure](./directory-structure.md)   | Layout and ownership of `skills/`, `agents/`, `config/`                                             | Done   |
| [Component Guidelines](./component-guidelines.md) | TUI projection rules: width-safe rendering, display-state vocabulary, startup card widget           | Done   |
| [Hook Guidelines](./hook-guidelines.md)           | How the package hooks into the Pi host: activation, exit, tool registration, loader-error surfacing | Done   |
| [State Management](./state-management.md)         | Display state vs durable state: what is never persisted, what is derived from already-read facts    | Done   |
| [Quality Guidelines](./quality-guidelines.md)     | Content verification: agent pins, prompt-activation contracts, lint coverage, loader bounds         | Done   |
| [Type Safety](./type-safety.md)                   | TypeBox schemas, strict JSON configuration, strict packet/result envelopes, canonical identity      | Done   |

---

Disconnected G2: [Session Adapter](./task-session-guidelines.md) covers the isolated `src/task-shell.ts` registrar/Create/Return/Open candidate (Gate 2 blocked, D unaccepted); [Source Host](./task-source-guidelines.md) covers shared native choices and accepted observable-currentness/N1 limits.
[Planning Host](./task-planning-guidelines.md) covers qualified accepted A/B/C admission/lifetime and the approved D checker seam, not production activation or complete-loop qualification.
Historical v1 failures remain; no production or full G2 acceptance.

## How to Use These Guidelines

Each file documents the actual conventions of this package, with real file paths and concrete examples taken from the code.
Treat a change to a prompt, skill, agent, or config example as a content change: it is linted, hash-pinned, and covered by the prompt-activation and distribution tests, so run those checks before publishing.
The Presentation & Content layer never owns durable state; when a displayed value must survive a session, it belongs to the backend storage layer, not to a widget.

---

**Language**: All documentation should be written in **English**.
