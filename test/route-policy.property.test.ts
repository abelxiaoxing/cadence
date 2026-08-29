import { describe, expect, it } from "vitest";
import { parseRoutePolicy } from "../src/route-policy.ts";

const ROLES = [
  "design-explorer",
  "contract-reviewer",
  "implementation-worker",
  "diagnosis-worker",
];

function validPolicy(): Record<string, unknown> {
  return {
    version: 2,
    routes: {
      parent: {
        kind: "inherited",
        capabilities: {
          roles: ROLES,
          dialects: ["openai-responses"],
          contextWindow: 256000,
          maxTokens: 128000,
        },
      },
    },
    roles: Object.fromEntries(ROLES.map((role) => [role, ["parent"]])),
  };
}

describe("closed route policy properties", () => {
  it("rejects every missing required top-level or route field", () => {
    for (const key of ["version", "routes", "roles"]) {
      const candidate = validPolicy();
      delete candidate[key];
      expect(parseRoutePolicy(candidate).ok, `missing ${key}`).toBe(false);
    }
    for (const key of ["kind", "capabilities"]) {
      const candidate = validPolicy();
      delete (candidate.routes as Record<string, Record<string, unknown>>)
        .parent[key];
      expect(parseRoutePolicy(candidate).ok, `missing route ${key}`).toBe(
        false,
      );
    }
  });

  it("never accepts an unknown role, dialect, reference, or extra field", () => {
    const mutations = [
      (candidate: Record<string, unknown>) => {
        (candidate.roles as Record<string, unknown>)["unknown-worker"] = [
          "parent",
        ];
      },
      (candidate: Record<string, unknown>) => {
        (candidate.roles as Record<string, unknown>)["implementation-worker"] =
          ["undeclared"];
      },
      (candidate: Record<string, unknown>) => {
        const route = (
          candidate.routes as Record<string, Record<string, unknown>>
        ).parent;
        (route.capabilities as Record<string, unknown>).dialects = [
          "unknown-api",
        ];
      },
      (candidate: Record<string, unknown>) => {
        (
          candidate.routes as Record<string, Record<string, unknown>>
        ).parent.url = "https://implicit-custom.invalid";
      },
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(validPolicy());
      mutate(candidate);
      expect(parseRoutePolicy(candidate).ok).toBe(false);
    }
  });

  it("parsing is deterministic and does not mutate caller data", () => {
    const candidate = validPolicy();
    const before = structuredClone(candidate);
    const first = parseRoutePolicy(candidate);
    const second = parseRoutePolicy(candidate);
    expect(first).toEqual(second);
    expect(candidate).toEqual(before);
    expect(first.ok).toBe(true);
  });

  it("rejects differently named routes with the same fingerprint", () => {
    const candidate = validPolicy() as any;
    candidate.routes.alias = structuredClone(candidate.routes.parent);
    for (const role of ROLES) candidate.roles[role] = ["parent", "alias"];
    expect(parseRoutePolicy(candidate)).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "route-duplicate" })],
    });
  });
});
