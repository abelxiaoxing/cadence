# Backend Development Guidelines

> Guidelines for the Cadence package code: the `src/` TypeScript modules, owner-private SQLite storage, the Design/Implement workflow engine, delivery, verification, and operator tooling.

---

## Overview

This directory covers the backend layer of `@abelxiaoxing/cadence`, the single Bun/TypeScript package that ships as a Pi extension.
There is no web server, database server, or REST API: "backend" here means the durable, owner-private control plane the extension runs inside the Pi process and on disk.
The layer spans the `src/` modules (activation, Design, Implement, delivery, verification, storage, operators), the maintenance `scripts/`, and the `test/` suite that verifies them.
The matching Presentation & Content layer (TUI projection plus prompt/skill/agent/config content) lives in `.trellis/spec/frontend/`.

---

## Guidelines Index

| Guide                                           | Description                                                            | Status |
| ----------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| [Directory Structure](./directory-structure.md) | Top-level layout, module ownership by domain, generated modules        | Done   |
| [Database Guidelines](./database-guidelines.md) | Owner-private SQLite storage, checked schemas, additive migrations     | Done   |
| [Error Handling](./error-handling.md)           | Fail-closed patterns and bounded diagnostic vocabulary                 | Done   |
| [Quality Guidelines](./quality-guidelines.md)   | Standalone commands, CI matrix, distribution rules, testing discipline | Done   |
| [Logging Guidelines](./logging-guidelines.md)   | Bounded secret-free diagnostics instead of free-form logging           | Done   |

---

## How to Use These Guidelines

Each file documents the actual conventions of this package, with real file paths and concrete examples taken from the code.
Read the file matching the layer you are touching before writing code, and prefer the existing module that already owns the concern over a new abstraction.
Changes to storage schemas, failure codes, or verification adapters have cross-module effects; search for the identifier before editing it.

---

**Language**: All documentation should be written in **English**.
