# Presentation & Content Guidelines

> This repository has no web frontend.
> This layer covers the Cadence TUI presentation (the subagent-activity widget and the startup card in `src/subagent-activity.ts` / `src/startup-card.ts`) plus the package-shipped content: the stage prompts in `prompts/`, the skills in `skills/`, the three professional Agents in `agents/`, and the example configuration in `config/`.

---

## Overview

The "frontend" of this package is a terminal presentation surface and a set of versioned, pinned content assets — there is no browser code, no component library, and no server-rendered page.
The package renders through `pi-tui` widgets inside the Pi session, and everything the user can read that is not a tool result (activity lines, the configuration card, the stage prompts, the skill documentation) is owned by this layer.
The package code itself (storage, workflow engine, delivery, verification, operators) is documented in `.trellis/spec/backend/`.

---

## Guidelines Index

| Guide                                             | Description                                                                                         | Status |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| [Directory Structure](./directory-structure.md)   | Layout and ownership of `prompts/`, `skills/`, `agents/`, `config/`                                 | Done   |
| [Component Guidelines](./component-guidelines.md) | TUI projection rules: width-safe rendering, display-state vocabulary, startup card widget           | Done   |
| [Hook Guidelines](./hook-guidelines.md)           | How the package hooks into the Pi host: activation, exit, tool registration, loader-error surfacing | Done   |
| [State Management](./state-management.md)         | Display state vs durable state: what is never persisted, what is derived from already-read facts    | Done   |
| [Quality Guidelines](./quality-guidelines.md)     | Content verification: agent pins, prompt-activation contracts, lint coverage, loader bounds         | Done   |
| [Type Safety](./type-safety.md)                   | TypeBox schemas, strict JSON configuration, strict packet/result envelopes, canonical identity      | Done   |

---

## How to Use These Guidelines

Each file documents the actual conventions of this package, with real file paths and concrete examples taken from the code.
Treat a change to a prompt, skill, agent, or config example as a content change: it is linted, hash-pinned, and covered by the prompt-activation and distribution tests, so run those checks before publishing.
The Presentation & Content layer never owns durable state; when a displayed value must survive a session, it belongs to the backend storage layer, not to a widget.

---

**Language**: All documentation should be written in **English**.
