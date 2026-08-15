import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const missingSync = (name) => () => {
  throw new Error(`${name} is not implemented`);
};
const missingAsync = (name) => async () => {
  throw new Error(`${name} is not implemented`);
};

const configModule = await import("../skills/_shared/load-config.mjs").catch(
  () => ({}),
);
const httpModule = await import("../skills/_shared/http-client.mjs").catch(
  () => ({}),
);
const context7Module = await import(
  "../skills/context7-auto-research/context7.mjs"
).catch(() => ({}));
const loadConfig = configModule.loadConfig ?? missingSync("loadConfig");
const parseEnvFile = configModule.parseEnvFile ?? missingSync("parseEnvFile");
const requestJson = httpModule.requestJson ?? missingAsync("requestJson");
const loadContext7Config =
  context7Module.loadContext7Config ?? missingSync("loadContext7Config");
const runContext7 = context7Module.runContext7 ?? missingAsync("runContext7");

const tempRoots = [];
const makeRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-abel-config-"));
  tempRoots.push(root);
  return root;
};
const writeEnv = (file, content) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};

afterEach(() => {
  for (const root of tempRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("whole-file configuration", () => {
  it("keeps project selection invariant under user-file mutations", () => {
    const root = makeRoot();
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    const projectFile = path.join(cwd, ".pi", "cadence", ".env");
    const userFile = path.join(home, ".pi", "agent", "cadence", ".env");
    writeEnv(projectFile, "CONTEXT7_API_KEY=project-secret\nUNKNOWN=project\n");

    for (const userContent of [
      "CONTEXT7_API_KEY=user-secret\nCONTEXT7_API_URL=https://user.invalid\n",
      "GROK_API_KEY=user-other\n",
      "",
    ]) {
      writeEnv(userFile, userContent);
      const selected = loadConfig({ cwd, home });
      expect(selected.path).toBe(projectFile);
      expect(selected.values.CONTEXT7_API_KEY).toBe("project-secret");
      expect(selected.values.CONTEXT7_API_URL).toBeUndefined();
    }
  });

  it("selects the user file only when the project file is absent", () => {
    const root = makeRoot();
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    const userFile = path.join(home, ".pi", "agent", "cadence", ".env");
    writeEnv(userFile, "CONTEXT7_API_KEY=user-secret\n");
    expect(loadConfig({ cwd, home })).toEqual({
      path: userFile,
      values: { CONTEXT7_API_KEY: "user-secret" },
    });
  });

  it("parses literal values without interpolation or execution", () => {
    const literalVariable = ["$", "{HOME}"].join("");
    expect(
      parseEnvFile(`
# comment
PLAIN=value
FIRST=a=b=c
SINGLE='${literalVariable}'
DOUBLE="$(touch /tmp/never)"
EMPTY=
UNKNOWN=kept
`),
    ).toEqual({
      PLAIN: "value",
      FIRST: "a=b=c",
      SINGLE: literalVariable,
      DOUBLE: "$(touch /tmp/never)",
      EMPTY: "",
      UNKNOWN: "kept",
    });
  });

  it("reports selected paths and missing names without leaking values", () => {
    const root = makeRoot();
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    const projectFile = path.join(cwd, ".pi", "cadence", ".env");
    writeEnv(projectFile, "GROK_API_KEY=do-not-leak\n");
    expect(() => loadConfig({ cwd, home, required: ["GROK_API_URL"] })).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(projectFile),
      }),
    );
    try {
      loadConfig({ cwd, home, required: ["GROK_API_URL"] });
    } catch (error) {
      expect(error.message).toContain("GROK_API_URL");
      expect(error.message).not.toContain("do-not-leak");
    }
  });

  it("ignores ambient process.env and package-relative configuration", () => {
    const root = makeRoot();
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    const projectFile = path.join(cwd, ".pi", "cadence", ".env");
    writeEnv(projectFile, "CONTEXT7_API_KEY=\n");
    process.env.CONTEXT7_API_URL = "https://ambient.invalid";
    const config = loadContext7Config({ cwd, home });
    delete process.env.CONTEXT7_API_URL;
    expect(config.apiUrl).toBe("https://context7.com/api/v2");
    expect(config.apiKey).toBe("");
    expect(config.path).toBe(projectFile);
  });
});

describe("shared HTTP reliability", () => {
  it("makes at most three attempts with one- and two-second defaults", async () => {
    const attempts = [];
    const waits = [];
    await expect(
      requestJson({
        operation: "property-network-error",
        url: "https://example.test/context?secret=hidden",
        fetchImpl: async () => {
          attempts.push(true);
          throw new Error("network failed with token do-not-leak");
        },
        sleep: async (ms) => waits.push(ms),
      }),
    ).rejects.not.toThrow(/do-not-leak|secret=hidden/);
    expect(attempts).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "does not retry non-retryable status %i",
    async (status) => {
      let attempts = 0;
      await expect(
        requestJson({
          operation: "non-retryable",
          url: "https://example.test/api",
          fetchImpl: async () => {
            attempts += 1;
            return new Response("credential do-not-leak", { status });
          },
          sleep: async () => {
            throw new Error("must not sleep");
          },
        }),
      ).rejects.not.toThrow(/do-not-leak/);
      expect(attempts).toBe(1);
    },
  );

  it.each([408, 429, 500, 502, 503, 504])(
    "retries status %i",
    async (status) => {
      let attempts = 0;
      const waits = [];
      const result = await requestJson({
        operation: "retryable-status",
        url: "https://example.test/api",
        fetchImpl: async () => {
          attempts += 1;
          return attempts < 3
            ? new Response("retry", { status })
            : Response.json({ ok: true });
        },
        sleep: async (ms) => waits.push(ms),
      });
      expect(result).toEqual({ ok: true });
      expect(attempts).toBe(3);
      expect(waits).toEqual([1000, 2000]);
    },
  );

  it("honors valid Retry-After values but caps each wait at ten seconds", async () => {
    const waits = [];
    let attempts = 0;
    await requestJson({
      operation: "retry-after",
      url: "https://example.test/api",
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1)
          return new Response("retry", {
            status: 429,
            headers: { "Retry-After": "20" },
          });
        if (attempts === 2)
          return new Response("retry", {
            status: 503,
            headers: {
              "Retry-After": new Date(Date.now() + 60_000).toUTCString(),
            },
          });
        return Response.json({ ok: true });
      },
      sleep: async (ms) => waits.push(ms),
    });
    expect(waits).toEqual([10_000, 10_000]);
  });

  it("fails malformed JSON immediately", async () => {
    let attempts = 0;
    await expect(
      requestJson({
        operation: "malformed-json",
        url: "https://example.test/api",
        fetchImpl: async () => {
          attempts += 1;
          return new Response("not-json", { status: 200 });
        },
        sleep: async () => {},
      }),
    ).rejects.toThrow(/malformed JSON/i);
    expect(attempts).toBe(1);
  });
});

describe("Context7 client", () => {
  const makeConfig = () => {
    const root = makeRoot();
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    writeEnv(
      path.join(cwd, ".pi", "cadence", ".env"),
      "CONTEXT7_API_URL=https://context.example/api/v2///\nCONTEXT7_API_KEY=context-secret\n",
    );
    return { cwd, home };
  };

  it("builds a search request and validates the results shape", async () => {
    const { cwd, home } = makeConfig();
    let request;
    const result = await runContext7({
      argv: ["search", "react", "hooks", "cleanup"],
      cwd,
      home,
      fetchImpl: async (url, init) => {
        request = { url: String(url), init };
        return Response.json({ results: [{ id: "/facebook/react" }] });
      },
      sleep: async () => {},
      readStdin: async () => "unused",
    });
    expect(result).toEqual({ results: [{ id: "/facebook/react" }] });
    const url = new URL(request.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://context.example/api/v2/libs/search",
    );
    expect(url.searchParams.get("libraryName")).toBe("react");
    expect(url.searchParams.get("query")).toBe("hooks cleanup");
    expect(request.init.headers.Authorization).toBe("Bearer context-secret");
  });

  it("reads a lone stdin dash completely for context", async () => {
    const { cwd, home } = makeConfig();
    let requestedUrl;
    const result = await runContext7({
      argv: ["context", "/facebook/react", "-"],
      cwd,
      home,
      fetchImpl: async (url) => {
        requestedUrl = new URL(url);
        return Response.json({
          codeSnippets: [],
          infoSnippets: [{ content: "docs" }],
        });
      },
      sleep: async () => {},
      readStdin: async () => "full query\nwith spaces",
    });
    expect(result.infoSnippets).toHaveLength(1);
    expect(requestedUrl.pathname).toBe("/api/v2/context");
    expect(requestedUrl.searchParams.get("libraryId")).toBe("/facebook/react");
    expect(requestedUrl.searchParams.get("query")).toBe(
      "full query\nwith spaces",
    );
    expect(requestedUrl.searchParams.get("type")).toBe("json");
  });

  it("closes on invalid arguments and response shapes before false success", async () => {
    const { cwd, home } = makeConfig();
    let attempts = 0;
    const options = {
      cwd,
      home,
      fetchImpl: async () => {
        attempts += 1;
        return Response.json({ unexpected: true });
      },
      sleep: async () => {},
      readStdin: async () => "",
    };
    await expect(
      runContext7({ ...options, argv: ["search", "react", "-", "extra"] }),
    ).rejects.toThrow(/only query argument/i);
    await expect(
      runContext7({ ...options, argv: ["context", "/facebook/react", "-"] }),
    ).rejects.toThrow(/empty/i);
    expect(attempts).toBe(0);
    await expect(
      runContext7({ ...options, argv: ["search", "react", "query"] }),
    ).rejects.toThrow(/response shape/i);
    expect(attempts).toBe(1);
  });
});
