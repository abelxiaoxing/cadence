---
name: context7-auto-research
description: Fetch current official library documentation from Context7 when library or framework APIs are needed
---

# Context7 auto research

Use this Skill proactively for current library/framework documentation, version-specific APIs, setup, migration, or code examples.
Run its CLI from this Skill directory.

## Commands

```bash
node context7.mjs search <library-name> <query|->
node context7.mjs context <library-id> <query|->
```

Use a lone `-` to pass the complete UTF-8 query through stdin without shell tokenization:

```bash
node context7.mjs search react - <<'QUERY'
<complete user question>
QUERY
```

Choose an exact official library match first, then version fit and trust score.
Fetch focused context for the selected library ID and answer from the returned current documentation.
Treat a non-zero exit, invalid shape, or empty useful result as a failed lookup; never present it as successful research.

The CLI selects the project `.pi/cadence/.env` as a whole file when present, otherwise `~/.pi/agent/cadence/.env`.
It does not merge files, read ambient API configuration, or read `.env` beside the installed package.
`CONTEXT7_API_KEY` may be empty; `CONTEXT7_API_URL` defaults to `https://context7.com/api/v2`.
