import { expect, it } from "vitest";
import { opticalGroups } from "../scripts/optical-fixtures/groups.mjs";

it("keeps the no-argument matrix whole; focused observations are explicit subsets", () => {
  const full = opticalGroups([]);
  const agents = opticalGroups(["--group=agent-scroll"]);
  expect(agents).toHaveLength(6);
  expect(full).toHaveLength(14);
  expect(new Set(full).size).toBe(full.length);
  for (const group of full)
    expect(opticalGroups([`--group=${group}`])).toEqual([group]);
  for (const group of agents) expect(full).toContain(group);
  for (const args of [
    ["dark"],
    ["--group="],
    ["--group=unknown"],
    ["--group=reading", "extra"],
  ])
    expect(() => opticalGroups(args)).toThrow("Expected");
});
