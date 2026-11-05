/** Shared physical-checkout Git execution policy. No inherited alternate index,
 * worktree, config injection or sudo-account trust; never writes configuration. */
export function gitEnvironment() {
  const root = process.getuid?.() === 0;
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.startsWith("GIT_") && !(root && name === "SUDO_UID"),
      ),
    ),
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_LAZY_FETCH: "1",
    LC_ALL: "C",
  };
}
export function gitArguments(args) {
  return [
    "--no-replace-objects",
    ...(process.platform !== "win32" && process.getuid?.() === 0
      ? ["-c", "safe.directory=", "-c", "core.fsmonitor=false"]
      : []),
    ...args,
  ];
}
