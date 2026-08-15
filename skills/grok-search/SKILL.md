---
name: grok-search
description: Search and retrieve current web information through a Grok-compatible gateway and optional Tavily operations
---

# Grok search

Use this Skill for current web search, page retrieval, site maps, and source-backed fact checking.
Run the dependency-free Node.js CLI from this Skill directory.

## Commands

```bash
node grok-search.mjs web_search --query <text> \
  [--platform <name>] [--min-results <n>] [--max-results <n>] \
  [--model <id>] [--extra-sources <n>]

node grok-search.mjs web_fetch --url <url> [--out <path>]

node grok-search.mjs web_map --url <url> \
  [--instructions <text>] [--max-depth <n>] \
  [--max-breadth <n>] [--limit <n>]

node grok-search.mjs get_config_info
```

Start with `web_search`, use `web_fetch` for a selected page, and use `web_map` for site structure.
Cite source URLs and relevant dates for time-sensitive answers.
Treat non-zero exits and invalid result shapes as failed research.

`web_search` returns normalized `{title,url,description}` objects.
`--extra-sources` explicitly requires enabled Tavily and fails rather than returning partial provider results.
`web_fetch` uses Tavily Markdown extraction when enabled, emits a sanitized warning on extract failure, then falls back to Grok.
`web_map` requires enabled Tavily.
`get_config_info` prints only the selected path, provider URLs, model, and enabled/configured booleans; it does not test the network or print keys.

The CLI selects the project `.pi/cadence/.env` as a whole file when present, otherwise `~/.pi/agent/cadence/.env`.
`GROK_API_URL` and `GROK_API_KEY` are required.
`GROK_MODEL` defaults to `grok-4.20-non-reasoning`, `TAVILY_API_URL` defaults to `https://api.tavily.com`, and Tavily is enabled by default once a non-empty `TAVILY_API_KEY` is configured; set `TAVILY_ENABLED=false` to opt out.
