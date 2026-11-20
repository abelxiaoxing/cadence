const views = ["dark", "light"].flatMap((theme) =>
  [320, 390, 1440].map((width) => `${theme}:${width}`),
);
const groups = [
  ...views.flatMap((view) => [view, `agent-scroll:${view}`]),
  "reading",
  "forced-colors",
];

/** Selection is explicit argv only: inherited environment cannot narrow an
 * approved no-argument full observation. Refuse typos before opening a site. */
export function opticalGroups(args) {
  if (!args.length) return [...groups];
  if (args.length === 1 && args[0].startsWith("--group=")) {
    const name = args[0].slice("--group=".length);
    if (groups.includes(name)) return [name];
    if (name === "agent-scroll")
      return groups.filter((g) => g.startsWith(`${name}:`));
  }
  throw new Error(
    `Expected no arguments or --group=<${[...groups, "agent-scroll"].join(" | ")}>`,
  );
}
