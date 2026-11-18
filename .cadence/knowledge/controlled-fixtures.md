# Controlled manager and socket fixtures

## Service test isolation

### The sun_path bound applies to the path given to bind

Kind: pitfall

Why: with an inherited TMPDIR deeper than 107 characters an absolute socket path fails at bind, so the fixture spawns a short-lived child with a deliberately long temporary cwd and binds the relative name, while the refusal assertion still names the long absolute path.

Anchors: `test/research-tools.test.mjs#a known socket under a long temporary path is not opened as a text file`

Source: this delivery, 2026-11-17

### Management CLI tests inject their manager and cgroup boundaries

Kind: pitfall

Why: a temporary HOME does not isolate the caller's cgroup, so `managedServer` invokes the real CLI handler with a fixture `AutostartSystem` for both the cgroup observation and the manager it checks against.

Anchors: `test/service-autostart.test.ts#managedServer`, `src/service/maintenance.ts#insideUnit`

Source: this delivery, 2026-11-17
