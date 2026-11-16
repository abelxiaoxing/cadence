# Controlled manager and socket fixtures

## Service test isolation

### The sun_path bound applies to the path given to bind

Kind: pitfall

Why: with an inherited TMPDIR deeper than 107 characters an absolute socket path fails at bind, so the fixture spawns a short-lived child with a deliberately long temporary cwd and binds the relative name, while the refusal assertion still names the long absolute path.

Anchors: `test/research-tools.test.mjs#a known socket under a long temporary path is not opened as a text file`

Source: this delivery, 2026-11-16

### Management CLI tests inject their manager and cgroup boundaries

Kind: pitfall

Why: changing HOME alone cannot isolate an inherited service cgroup.
The main-branch `managedServer` fixture calls the real CLI handler with injected `AutostartSystem` manager and cgroup ports, so the self-management refusal stays covered without calling the host service manager.

Anchors: `test/service-autostart.test.ts#managedServer`, `src/service/maintenance.ts#cgroupPath`

Source: this delivery, 2026-11-16
