# Controlled manager and socket fixtures

## Service test isolation

### The sun_path bound applies to the path given to bind

Kind: pitfall

Why: with an inherited TMPDIR deeper than 107 characters an absolute socket path fails at bind, so the fixture spawns a listener with the temp root as cwd and binds the relative name, while the refusal assertion still names the long absolute path.

Anchors: `test/research-tools.test.mjs#a known socket is not opened as a text file`

Source: this delivery, 2026-11-16

### The spawned CLI's manager boundary is its PATH, and /proc/self/cgroup is real

Kind: pitfall

Why: insideUnit reads the real `/proc/self/cgroup`, so HOME and XDG_RUNTIME_DIR alone cannot isolate a management CLI fixture; shadowing `systemctl`, `loginctl` and `busctl` in a PATH bin dir leaves the shim's ControlGroup answer as the only controllable boundary.

Anchors: `test/service-autostart.test.ts#manager`, `src/service/maintenance.ts#cgroupPath`

Source: this delivery, 2026-11-16
