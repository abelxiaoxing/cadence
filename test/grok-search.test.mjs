import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const missingSync = (name) => () => {
  throw new Error(`${name} is not implemented`);
};
const missingAsync = (name) => async () => {
  throw new Error(`${name} is not implemented`);
};
const grokModule = await import("../skills/grok-search/grok-search.mjs").catch(
  () => ({}),
);
const loadGrokConfig =
  grokModule.loadGrokConfig ?? missingSync("loadGrokConfig");
const mergeSources = grokModule.mergeSources ?? missingSync("mergeSources");
const runGrokSearch = grokModule.runGrokSearch ?? missingAsync("runGrokSearch");

const roots = [];
const makeConfig = ({ tavilyEnabled, tavilyKey = "", extra = "" } = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-abel-grok-"));
  roots.push(root);
  const cwd = path.join(root, "project");
  const home = path.join(root, "home");
  const configPath = path.join(cwd, ".pi", "cadence", ".env");
  mkdirSync(path.dirname(configPath), { recursive: true });
  const lines = [
    "GROK_API_URL=https://grok.example/v1///",
    "GROK_API_KEY=grok-secret",
  ];
  if (tavilyEnabled !== undefined)
    lines.push(`TAVILY_ENABLED=${tavilyEnabled}`);
  lines.push(
    "TAVILY_API_URL=https://tavily.example///",
    `TAVILY_API_KEY=${tavilyKey}`,
    extra,
  );
  writeFileSync(configPath, lines.join("\n"));
  return { root, cwd, home, configPath };
};
const chatResponse = (content) =>
  Response.json({ choices: [{ message: { content } }] });
const searchResults = [
  { title: "One", url: "https://one.example/a", description: "first" },
  { title: "Two", url: "https://two.example/b", description: "second" },
];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("Grok and Tavily configuration", () => {
  it("defaults Tavily to enabled when a key is configured", () => {
    const { cwd, home, configPath } = makeConfig({
      tavilyKey: "tavily-secret",
    });
    const config = loadGrokConfig({ cwd, home });
    expect(config).toMatchObject({
      path: configPath,
      grokUrl: "https://grok.example/v1///",
      model: "grok-4.20-non-reasoning",
      tavilyUrl: "https://tavily.example///",
      tavilyEnabled: true,
      tavilyConfigured: true,
    });
    expect(config.grokKey).toBe("grok-secret");
  });

  it("honors explicit TAVILY_ENABLED=false to opt out", () => {
    const { cwd, home } = makeConfig({
      tavilyEnabled: "false",
      tavilyKey: "tavily-secret",
    });
    const config = loadGrokConfig({ cwd, home });
    expect(config.tavilyEnabled).toBe(false);
    expect(config.tavilyConfigured).toBe(true);
  });

  it("get_config_info is sanitized and performs no network call", async () => {
    const { cwd, home, configPath } = makeConfig({
      tavilyEnabled: true,
      tavilyKey: "tavily-secret",
      extra: "GROK_MODEL=custom-model",
    });
    let attempts = 0;
    const result = await runGrokSearch({
      argv: ["get_config_info"],
      cwd,
      home,
      fetchImpl: async () => {
        attempts += 1;
        throw new Error("must not fetch");
      },
    });
    expect(attempts).toBe(0);
    expect(result).toEqual({
      configPath,
      grokApiUrl: "https://grok.example/v1",
      model: "custom-model",
      grokConfigured: true,
      tavilyApiUrl: "https://tavily.example",
      tavilyEnabled: true,
      tavilyConfigured: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/grok-secret|tavily-secret/);
  });
});

describe("numeric option boundaries", () => {
  it.each([
    ["--min-results", "0"],
    ["--min-results", "01"],
    ["--min-results", "1.0"],
    ["--max-results", "9007199254740992"],
    ["--extra-sources", "-1"],
    ["--extra-sources", "21"],
  ])("rejects web_search %s=%s before fetch", async (option, value) => {
    const { cwd, home } = makeConfig({
      tavilyEnabled: true,
      tavilyKey: "tavily-secret",
    });
    let attempts = 0;
    await expect(
      runGrokSearch({
        argv: ["web_search", "--query", "q", option, value],
        cwd,
        home,
        fetchImpl: async () => {
          attempts += 1;
          return Response.json({});
        },
      }),
    ).rejects.toThrow(/integer|range|canonical|safe/i);
    expect(attempts).toBe(0);
  });

  it("rejects max-results below min-results before fetch", async () => {
    const { cwd, home } = makeConfig();
    let attempts = 0;
    await expect(
      runGrokSearch({
        argv: [
          "web_search",
          "--query",
          "q",
          "--min-results",
          "4",
          "--max-results",
          "3",
        ],
        cwd,
        home,
        fetchImpl: async () => {
          attempts += 1;
        },
      }),
    ).rejects.toThrow(/max-results.*min-results/i);
    expect(attempts).toBe(0);
  });

  it.each([
    ["--max-depth", "0"],
    ["--max-depth", "6"],
    ["--max-breadth", "0"],
    ["--limit", "0"],
    ["--limit", "01"],
  ])("rejects web_map %s=%s before fetch", async (option, value) => {
    const { cwd, home } = makeConfig({
      tavilyEnabled: true,
      tavilyKey: "tavily-secret",
    });
    let attempts = 0;
    await expect(
      runGrokSearch({
        argv: ["web_map", "--url", "https://site.example", option, value],
        cwd,
        home,
        fetchImpl: async () => {
          attempts += 1;
        },
      }),
    ).rejects.toThrow(/integer|range|canonical/i);
    expect(attempts).toBe(0);
  });
});

describe("web_search", () => {
  it("uses non-streaming Chat Completions and normalized results", async () => {
    const { cwd, home } = makeConfig();
    let request;
    const result = await runGrokSearch({
      argv: [
        "web_search",
        "--query",
        "current docs",
        "--platform",
        "GitHub",
        "--min-results",
        "2",
        "--max-results",
        "2",
        "--model",
        "override-model",
      ],
      cwd,
      home,
      fetchImpl: async (url, init) => {
        request = { url: String(url), init, body: JSON.parse(init.body) };
        return chatResponse(JSON.stringify(searchResults));
      },
      sleep: async () => {},
    });
    expect(result).toEqual(searchResults);
    expect(request.url).toBe("https://grok.example/v1/chat/completions");
    expect(request.init.headers.Authorization).toBe("Bearer grok-secret");
    expect(request.body).toMatchObject({
      model: "override-model",
      stream: false,
    });
    expect(request.body.messages[0].content).toMatch(/JSON array/i);
    expect(request.body.messages[1].content).toMatch(
      /current docs[\s\S]*GitHub/,
    );
  });

  it("fails invalid result URLs, malformed JSON, and unsatisfied counts", async () => {
    const { cwd, home } = makeConfig();
    for (const content of [
      "not-json",
      JSON.stringify([
        { title: "bad", url: "file:///tmp/a", description: "bad" },
      ]),
      JSON.stringify([searchResults[0]]),
    ]) {
      await expect(
        runGrokSearch({
          argv: [
            "web_search",
            "--query",
            "q",
            "--min-results",
            "2",
            "--max-results",
            "2",
          ],
          cwd,
          home,
          fetchImpl: async () => chatResponse(content),
          sleep: async () => {},
        }),
      ).rejects.toThrow(/JSON|HTTP|result contract/i);
    }
  });

  it("requires configured Tavily before explicit extra-source work", async () => {
    const { cwd, home } = makeConfig();
    let attempts = 0;
    await expect(
      runGrokSearch({
        argv: ["web_search", "--query", "q", "--extra-sources", "2"],
        cwd,
        home,
        fetchImpl: async () => {
          attempts += 1;
        },
      }),
    ).rejects.toThrow(/Tavily.*required/i);
    expect(attempts).toBe(0);
  });

  it("merges Grok then Tavily in first-occurrence URL order", async () => {
    const { cwd, home } = makeConfig({
      tavilyEnabled: true,
      tavilyKey: "tavily-secret",
    });
    const calls = [];
    const result = await runGrokSearch({
      argv: [
        "web_search",
        "--query",
        "q",
        "--min-results",
        "2",
        "--max-results",
        "2",
        "--extra-sources",
        "3",
      ],
      cwd,
      home,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        if (String(url).endsWith("/search")) {
          return Response.json({
            results: [
              {
                title: "duplicate",
                url: "https://one.example/a",
                content: "later",
              },
              {
                title: "Three",
                url: "https://three.example/c",
                content: "third",
              },
            ],
          });
        }
        return chatResponse(JSON.stringify(searchResults));
      },
      sleep: async () => {},
    });
    expect(calls[0]).toMatchObject({
      url: "https://tavily.example/search",
      body: { query: "q", max_results: 3 },
    });
    expect(result.map((item) => item.url)).toEqual([
      "https://one.example/a",
      "https://two.example/b",
      "https://three.example/c",
    ]);
    expect(mergeSources(searchResults, searchResults)).toEqual(searchResults);
  });

  it("does not report partial success when required Tavily search fails", async () => {
    const { cwd, home } = makeConfig({
      tavilyEnabled: true,
      tavilyKey: "tavily-secret",
    });
    let attempts = 0;
    await expect(
      runGrokSearch({
        argv: ["web_search", "--query", "q", "--extra-sources", "2"],
        cwd,
        home,
        fetchImpl: async () => {
          attempts += 1;
          return new Response("tavily-secret", { status: 401 });
        },
        sleep: async () => {},
      }),
    ).rejects.not.toThrow(/tavily-secret/);
    expect(attempts).toBe(1);
  });
});

describe("web_fetch and web_map", () => {
  it("returns Tavily Markdown without Grok when extract succeeds", async () => {
    const { cwd, home } = makeConfig({
      tavilyEnabled: true,
      tavilyKey: "tavily-secret",
    });
    const calls = [];
    const result = await runGrokSearch({
      argv: ["web_fetch", "--url", "https://page.example"],
      cwd,
      home,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return Response.json({
          results: [
            { url: "https://page.example", raw_content: "# Page\n\nBody" },
          ],
        });
      },
      sleep: async () => {},
      warn: () => {
        throw new Error("must not warn");
      },
    });
    expect(result).toBe("# Page\n\nBody");
    expect(calls).toEqual([
      {
        url: "https://tavily.example/extract",
        body: { urls: ["https://page.example"], format: "markdown" },
      },
    ]);
  });

  it("warns safely then falls back to Grok when extract fails", async () => {
    const { cwd, home } = makeConfig({
      tavilyEnabled: true,
      tavilyKey: "tavily-secret",
    });
    const warnings = [];
    let attempts = 0;
    const result = await runGrokSearch({
      argv: ["web_fetch", "--url", "https://page.example"],
      cwd,
      home,
      fetchImpl: async (url) => {
        attempts += 1;
        if (String(url).endsWith("/extract")) {
          return new Response("tavily-secret response", { status: 400 });
        }
        return chatResponse("# Grok fallback\n\nContent");
      },
      sleep: async () => {},
      warn: (message) => warnings.push(message),
    });
    expect(result).toMatch(/Grok fallback/);
    expect(attempts).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toMatch(/tavily-secret|response/);
  });

  it("writes --out only after a successful fetch", async () => {
    const { root, cwd, home } = makeConfig();
    const output = path.join(root, "out.md");
    const result = await runGrokSearch({
      argv: ["web_fetch", "--url", "https://page.example", "--out", output],
      cwd,
      home,
      fetchImpl: async () => chatResponse("# Saved\n"),
      sleep: async () => {},
    });
    expect(result).toEqual({ out: output });
    expect(readFileSync(output, "utf8")).toBe("# Saved\n");
  });

  it("closes web_map before fetch when Tavily is unavailable", async () => {
    const { cwd, home } = makeConfig();
    let attempts = 0;
    await expect(
      runGrokSearch({
        argv: ["web_map", "--url", "https://site.example"],
        cwd,
        home,
        fetchImpl: async () => {
          attempts += 1;
        },
      }),
    ).rejects.toThrow(/Tavily.*required/i);
    expect(attempts).toBe(0);
  });

  it("round-trips accepted map integers in the Tavily request", async () => {
    const { cwd, home } = makeConfig({
      tavilyEnabled: true,
      tavilyKey: "tavily-secret",
    });
    let body;
    const result = await runGrokSearch({
      argv: [
        "web_map",
        "--url",
        "https://site.example",
        "--instructions",
        "docs only",
        "--max-depth",
        "5",
        "--max-breadth",
        "9007199254740991",
        "--limit",
        "25",
      ],
      cwd,
      home,
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body);
        return Response.json({
          base_url: "https://site.example",
          results: ["/docs"],
        });
      },
      sleep: async () => {},
    });
    expect(body).toEqual({
      url: "https://site.example",
      instructions: "docs only",
      max_depth: 5,
      max_breadth: Number.MAX_SAFE_INTEGER,
      limit: 25,
    });
    expect(result.results).toEqual(["/docs"]);
  });
});

describe("provider redaction and retries", () => {
  it("keeps secrets out of final Grok errors after three attempts", async () => {
    const { cwd, home } = makeConfig();
    let attempts = 0;
    await expect(
      runGrokSearch({
        argv: ["web_search", "--query", "q"],
        cwd,
        home,
        fetchImpl: async () => {
          attempts += 1;
          return new Response("grok-secret response", { status: 503 });
        },
        sleep: async () => {},
      }),
    ).rejects.not.toThrow(/grok-secret|response/);
    expect(attempts).toBe(3);
  });
});
