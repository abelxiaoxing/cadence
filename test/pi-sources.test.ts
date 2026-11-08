// The owner's Pi source checks: the pinned SDK's models.json fields (closed),
// diagnosable refusals that carry no value, and doctor running the same checks.
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { doctor } from "../src/service/doctor.ts";
import {
  checkPiSources,
  type FieldCheck,
  MODELS_JSON,
  type PiSourceProblem,
  PiSourceRefusal,
  piSource,
  sdkRefusal,
} from "../src/service/model-config.ts";
import {
  decodeStartupReport,
  describePiProblem,
  preflightPi,
  StartupRefusal,
  type StartupReport,
  startupReport,
} from "../src/service/runtime.ts";

/** Fabricated; no refusal, report or doctor line may ever contain it. */
const SECRET = "FABRICATED_cadence_secret_DO_NOT_REPORT_514";

function agent(models?: unknown, auth: unknown = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cadence-pi-sources-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir);
  const write = (name: string, value: unknown) =>
    writeFileSync(
      join(agentDir, name),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  write("auth.json", auth);
  if (models !== undefined) write("models.json", models);
  return { dir, agentDir, write };
}
/** What the owner's pre-bind check refuses, or null when it passes. */
function refused(agentDir: string): PiSourceRefusal | null {
  try {
    checkPiSources(agentDir, dirname(agentDir), dirname(agentDir), {});
    return null;
  } catch (error) {
    if (error instanceof PiSourceRefusal) return error;
    throw error;
  }
}
const problem = (agentDir: string) => refused(agentDir)?.problem ?? null;
const zai = (
  model: Record<string, unknown> = {},
  provider: Record<string, unknown> = {},
) => ({
  providers: {
    zai: {
      baseUrl: "http://127.0.0.1:9/v1",
      api: "openai-completions",
      apiKey: SECRET,
      ...provider,
      models: [{ id: "glm", reasoning: true, ...model }],
    },
  },
});
function expectNoSecret(value: unknown) {
  expect(JSON.stringify(value) ?? "").not.toContain(SECRET);
}

describe("the reported compat fields, against the pinned Pi SDK", () => {
  it("accepts zaiToolStream, which the pinned SDK declares and sends as tool_stream", () => {
    const { agentDir } = agent(
      zai({ compat: { thinkingFormat: "zai", zaiToolStream: true } }),
    );
    expect(problem(agentDir)).toBeNull();
    const provider = agent(zai({}, { compat: { zaiToolStream: false } }));
    expect(problem(provider.agentDir)).toBeNull();
  });
  it("refuses reasoningEffortMap, which Pi 0.72 replaced, with its path and migration", () => {
    for (const [doc, field] of [
      [
        zai({ compat: { reasoningEffortMap: { high: "high" } } }),
        "providers.zai.models[0].compat.reasoningEffortMap",
      ],
      [
        zai({}, { compat: { reasoningEffortMap: { high: "high" } } }),
        "providers.zai.compat.reasoningEffortMap",
      ],
    ] as const) {
      const { agentDir } = agent(doc);
      const refusal = refused(agentDir);
      expect(refusal?.code).toBe("corrupt-selected");
      expect(refusal?.problem).toEqual({
        file: "models.json",
        check: "schema",
        field,
        reason: expect.stringContaining("thinkingLevelMap"),
      });
      expect(refusal?.problem.reason).toContain("Pi 0.72");
    }
  });
  it("with both fields, refuses at reasoningEffortMap and never drops it silently", () => {
    const { agentDir } = agent(
      zai({
        compat: {
          zaiToolStream: true,
          reasoningEffortMap: { high: "high" },
        },
      }),
    );
    expect(problem(agentDir)?.field).toBe(
      "providers.zai.models[0].compat.reasoningEffortMap",
    );
    expect(readFileSync(join(agentDir, "models.json"), "utf8")).toContain(
      "reasoningEffortMap",
    );
  });
  it("accepts the supported migration target, thinkingLevelMap (string or null)", () => {
    const { agentDir } = agent(
      zai({
        thinkingLevelMap: { off: null, high: "high", xhigh: "max" },
        compat: { zaiToolStream: true },
      }),
    );
    expect(problem(agentDir)).toBeNull();
  });
  it("refuses an unknown level or a wrongly typed value, naming the field", () => {
    for (const [model, field, reason] of [
      [
        { thinkingLevelMap: { turbo: "x" } },
        "providers.zai.models[0].thinkingLevelMap.turbo",
        "is not a field Cadence's pinned Pi SDK supports",
      ],
      [
        { thinkingLevelMap: { high: 1 } },
        "providers.zai.models[0].thinkingLevelMap.high",
        "must be a string or null",
      ],
      [
        { compat: { zaiToolStream: SECRET } },
        "providers.zai.models[0].compat.zaiToolStream",
        "must be true or false",
      ],
      [
        { compat: { futureFlag: true } },
        "providers.zai.models[0].compat.futureFlag",
        "is not a field Cadence's pinned Pi SDK supports",
      ],
      // Accepted before for Pi 0.84; the pinned SDK no longer declares it.
      [
        { compat: { supportsToolReferences: true } },
        "providers.zai.models[0].compat.supportsToolReferences",
        "is not a field Cadence's pinned Pi SDK supports",
      ],
      // The SDK would refuse these only after an owner registered (pi-runtime).
      [
        { contextWindow: "big" },
        "providers.zai.models[0].contextWindow",
        "must be a number greater than 0",
      ],
      [
        { cost: { input: 1 } },
        "providers.zai.models[0].cost.output",
        "is required",
      ],
    ] as const) {
      const { agentDir } = agent(zai(model));
      const found = problem(agentDir);
      expect(found).toEqual({
        file: "models.json",
        check: "schema",
        field,
        reason,
      });
      expectNoSecret(found);
    }
  });
});

// The pinned SDK publishes its models.json schema; Cadence closes it. Every
// declared field must be accepted with a value of its type, refused with a
// value of another type, and nothing else accepted at any object level.
// The installed pinned peer (its exports name no package.json or schema path).
const sdkRoot = fileURLToPath(
  new URL("../node_modules/@earendil-works/pi-coding-agent/", import.meta.url),
);
type Node = any;
const sdkSchema: Node = JSON.parse(
  readFileSync(join(sdkRoot, "schemas", "models.schema.json"), "utf8"),
);
const deref = (node: Node): Node =>
  node?.$ref ? sdkSchema.$defs[node.$ref.split("/").pop()] : node;
const objectBranch = (node: Node): Node | undefined => {
  const n = deref(node);
  if (n.properties) return n;
  return (n.anyOf ?? []).map(deref).find((b: Node) => b.properties);
};
const entryOf = (node: Node): Node | undefined =>
  deref(node).patternProperties?.["^.*$"];
function sample(node: Node): unknown {
  const n = deref(node);
  if (n.const !== undefined) return n.const;
  if (n.enum) return n.enum[0];
  if (n.anyOf) return sample(n.anyOf[0]);
  if (n.type === "boolean") return true;
  if (n.type === "number" || n.type === "integer") return 1;
  if (n.type === "string") return "x";
  if (n.type === "array") return [];
  return Object.fromEntries(
    (n.required ?? []).map((k: string) => [k, sample(n.properties[k])]),
  );
}
/** A value no branch of the node accepts, or undefined for a free-form one. */
function wrong(node: Node): unknown {
  const n = deref(node);
  if (n.anyOf)
    return n.anyOf.every((b: Node) => deref(b).const !== undefined)
      ? "not-a-declared-value"
      : [];
  if (n.const !== undefined || n.enum) return "not-a-declared-value";
  return (
    (
      {
        boolean: "yes",
        number: "1",
        integer: "1",
        string: 1,
        array: "x",
      } as Record<string, unknown>
    )[n.type] ?? (n.type === "object" ? "x" : undefined)
  );
}
type Path = (string | number)[];
/** A minimal valid document with `leaf` at `path` (required siblings sampled). */
function build(node: Node, path: Path, leaf: unknown): unknown {
  const n = deref(node);
  if (!path.length) return leaf;
  const [key, ...rest] = path;
  if (typeof key === "number") return [build(n.items, rest, leaf)];
  const branch = objectBranch(n);
  if (branch?.properties?.[key])
    return {
      ...(sample(branch) as object),
      [key]: build(branch.properties[key], rest, leaf),
    };
  return { [key]: build(entryOf(n), rest, leaf) };
}
const shown = (path: Path) =>
  path
    .map((k, i) => (typeof k === "number" ? `[${k}]` : i ? `.${k}` : k))
    .join("");
/** Every primitive leaf and every object level of the SDK schema. */
function walk(
  node: Node,
  check: FieldCheck,
  path: Path,
  visit: (path: Path, node: Node, check: FieldCheck, object: boolean) => void,
) {
  const n = deref(node);
  const branch = objectBranch(n);
  if (branch) {
    expect(check.fields, shown(path)).toBeDefined();
    expect(Object.keys(check.fields ?? {}).sort(), shown(path)).toEqual(
      Object.keys(branch.properties).sort(),
    );
    visit(path, branch, check, true);
    for (const [key, sub] of Object.entries(branch.properties))
      walk(sub, check.fields?.[key] as FieldCheck, [...path, key], visit);
    if (!n.anyOf) return;
  }
  if (n.type === "array" && deref(n.items).type === "object") {
    expect(check.items, shown(path)).toBeDefined();
    walk(n.items, check.items as FieldCheck, [...path, 0], visit);
    return;
  }
  const entry = entryOf(n);
  if (entry && (objectBranch(entry) || deref(entry).type)) {
    expect(check.entries, shown(path)).toBeDefined();
    if (objectBranch(entry))
      walk(entry, check.entries as FieldCheck, [...path, "k"], visit);
    else visit([...path, "k"], entry, check.entries as FieldCheck, false);
    return;
  }
  if (!branch) visit(path, n, check, false);
}

describe("Cadence's models.json schema is exactly the pinned SDK's, closed", () => {
  it("declares the same fields at every object level as the SDK's published schema", () => {
    let objects = 0;
    walk(sdkSchema, MODELS_JSON, [], (_p, _n, _c, object) => {
      if (object) objects++;
    });
    // Root, provider, model, override, compat, routing and nested shapes.
    expect(objects).toBeGreaterThan(20);
  });
  it("accepts each field with a value of its type and refuses another type at its path", () => {
    // The same closed check readPiModels applies, in memory (the file path is
    // covered below), so that every field of the schema stays a fast case.
    const field = (doc: unknown): string | null => {
      try {
        MODELS_JSON(doc, "");
        return null;
      } catch (error) {
        return (error as { field?: string }).field ?? "unknown";
      }
    };
    const { agentDir, write } = agent();
    let leaves = 0;
    walk(sdkSchema, MODELS_JSON, [], (path, node, _check, object) => {
      const at = shown(path);
      if (object) {
        // Nothing beyond the SDK's fields, at every level.
        expect(
          field(build(sdkSchema, [...path, "notAPiField"], true)),
          at,
        ).toBe(at ? `${at}.notAPiField` : "notAPiField");
        return;
      }
      leaves++;
      const good = build(sdkSchema, path, sample(node));
      expect(field(good), `${at} = ${JSON.stringify(sample(node))}`).toBeNull();
      const bad = wrong(node);
      if (bad === undefined) return;
      expect(
        field(build(sdkSchema, path, bad)),
        `${at} = ${JSON.stringify(bad)}`,
      ).toBe(at);
      if (leaves % 16 === 0) {
        // And through the owner's real file read, for a sample of fields.
        write("models.json", good as object);
        expect(problem(agentDir), at).toBeNull();
        write("models.json", build(sdkSchema, path, bad) as object);
        expect(problem(agentDir), at).toMatchObject({
          file: "models.json",
          check: "schema",
          field: at,
        });
      }
    });
    expect(leaves).toBeGreaterThan(80);
  });
});

describe("refusals name the check, the file and the field, never a value", () => {
  it("file checks: link, hard link, kind, size and absence", () => {
    const cases: [
      string,
      (dir: string, agentDir: string) => void,
      Partial<PiSourceProblem>,
    ][] = [
      [
        "symlinked models.json",
        (dir, agentDir) => {
          writeFileSync(join(dir, "elsewhere.json"), JSON.stringify(zai()));
          symlinkSync(
            join(dir, "elsewhere.json"),
            join(agentDir, "models.json"),
          );
        },
        {
          file: "models.json",
          reason: expect.stringContaining("symbolic link"),
        },
      ],
      [
        "hard-linked auth.json",
        (dir, agentDir) =>
          linkSync(join(agentDir, "auth.json"), join(dir, "alias")),
        { file: "auth.json", reason: expect.stringContaining("2 hard links") },
      ],
      [
        "directory as models.json",
        (_dir, agentDir) => mkdirSync(join(agentDir, "models.json")),
        { file: "models.json", reason: "is not a regular file" },
      ],
      [
        "oversized models.json",
        (_dir, agentDir) =>
          writeFileSync(
            join(agentDir, "models.json"),
            " ".repeat(1024 * 1024 + 1),
          ),
        { file: "models.json", reason: "is larger than 1 MiB" },
      ],
      [
        "missing auth.json",
        (dir, agentDir) =>
          renameSync(join(agentDir, "auth.json"), join(dir, "a")),
        {
          file: "auth.json",
          reason: expect.stringContaining("does not exist"),
        },
      ],
      [
        "missing agent directory",
        (dir, agentDir) => renameSync(agentDir, join(dir, "moved")),
        {
          file: "agent-directory",
          reason: expect.stringContaining("does not exist"),
        },
      ],
      [
        "symlinked agent directory",
        (dir, agentDir) => {
          renameSync(agentDir, join(dir, "real"));
          symlinkSync(join(dir, "real"), agentDir);
        },
        {
          file: "agent-directory",
          reason: expect.stringContaining("symbolic link"),
        },
      ],
    ];
    for (const [name, damage, expected] of cases) {
      const { dir, agentDir } = agent();
      damage(dir, agentDir);
      expect(problem(agentDir), name).toEqual({
        check: "file",
        field: null,
        ...expected,
      });
    }
  });
  // POSIX ownership and mode are skipped on Windows; the link, kind, size and
  // identity checks are not. This simulates Cadence's win32 branch on this
  // host; it is not a run on Windows.
  describe("with process.platform reported as win32 (simulated)", () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    afterEach(() => {
      if (platform) Object.defineProperty(process, "platform", platform);
    });
    it("keeps refusing links and wrong fields exactly as on Linux and macOS", () => {
      const verdicts = () => {
        const linked = agent(zai());
        linkSync(join(linked.agentDir, "auth.json"), join(linked.dir, "alias"));
        return [
          problem(agent(zai({ compat: { zaiToolStream: true } })).agentDir),
          problem(agent(zai({ compat: { reasoningEffortMap: {} } })).agentDir),
          problem(linked.agentDir),
        ];
      };
      const posix = verdicts();
      Object.defineProperty(process, "platform", { value: "win32" });
      expect(verdicts()).toEqual(posix);
      expect(posix[0]).toBeNull();
      expect(posix[1]?.field).toContain("reasoningEffortMap");
      expect(posix[2]?.reason).toContain("hard links");
    });
  });
  it("JSON syntax: a line number at most, never the parser's quoted bytes", () => {
    const broken = `{\n  "providers": {"zai": {"apiKey": "${SECRET}",,}}\n}`;
    let parser = "";
    try {
      JSON.parse(broken);
    } catch (error) {
      parser = (error as Error).message;
    }
    const { agentDir, write } = agent(broken);
    const found = problem(agentDir);
    expect(found).toMatchObject({
      file: "models.json",
      check: "json",
      field: null,
    });
    expect(found?.reason).toMatch(/^is not valid JSON/);
    expectNoSecret(found);
    // The parser's own message may quote the input; it is never passed on.
    if (parser.includes(SECRET)) expect(found?.reason).not.toContain(parser);
    write("models.json", `{"providers": {"a": {}, "a": {}}}`);
    expect(problem(agentDir)?.reason).toContain("duplicate key");
    writeFileSync(
      join(agentDir, "models.json"),
      Buffer.from([0x7b, 0xff, 0x7d]),
    );
    expect(problem(agentDir)?.reason).toBe("is not valid UTF-8 text");
    // Pi's models.json syntax: line comments and trailing commas only.
    write(
      "models.json",
      `// selected\n{"providers": {"zai": {"apiKey": "k", // note\n "models": [{"id": "m",},],},},}`,
    );
    expect(problem(agentDir)).toBeNull();
    write("auth.json", `{ // comment\n}`);
    expect(problem(agentDir)).toMatchObject({
      file: "auth.json",
      check: "json",
    });
  });
  it("credentials and command templates are refused by field, without their values", () => {
    const cases: [unknown, unknown, string, string][] = [
      [
        zai({}, { apiKey: `!cat ${SECRET}` }),
        {},
        "providers.zai.apiKey",
        "unsupported-context",
      ],
      [
        zai({}, { headers: { "X-Key": `${SECRET}\r\n` } }),
        {},
        'providers.zai.headers["X-Key"]',
        "corrupt-selected",
      ],
      [
        zai(),
        { zai: { type: "api_key", key: `!echo ${SECRET}` } },
        "zai.key",
        "unsupported-context",
      ],
      [
        zai(),
        { zai: { type: "api_key", key: SECRET, extra: SECRET } },
        "zai.extra",
        "corrupt-selected",
      ],
      [zai(), { zai: { type: SECRET } }, "zai.type", "corrupt-selected"],
      [
        zai(),
        {
          zai: {
            type: "api_key",
            env: { GOOGLE_APPLICATION_CREDENTIALS: SECRET },
          },
        },
        "zai.env.GOOGLE_APPLICATION_CREDENTIALS",
        "unsupported-context",
      ],
    ];
    for (const [models, auth, field, code] of cases) {
      const { agentDir } = agent(models, auth);
      const refusal = refused(agentDir);
      expect(refusal?.code, field).toBe(code);
      expect(refusal?.problem.field).toBe(field);
      expectNoSecret(refusal?.problem);
      expectNoSecret(describePiProblem(refusal?.problem as PiSourceProblem));
    }
  });
  it("the SDK's own refusal is reduced to a path and fixed words", () => {
    const file = `\n\nFile: /home/u/.pi/agent/models.json`;
    expect(
      sdkRefusal(
        `Invalid models.json schema:\n  - providers.zai.models.0.contextWindow: must be number${file}`,
      ).problem,
    ).toEqual({
      file: "models.json",
      check: "sdk",
      field: "providers.zai.models.0.contextWindow",
      reason: "must be number",
    });
    expect(
      sdkRefusal(
        `Provider "zai": Provider zai: "baseUrl" is required when defining custom models.`,
      ).problem,
    ).toEqual({
      file: "models.json",
      check: "sdk",
      field: "providers.zai",
      reason: 'defines models but has no "baseUrl"',
    });
    const opaque = sdkRefusal(
      `Failed to parse models.json: Unexpected token '}', "{"apiKey": "${SECRET}"}" is not valid JSON${file}`,
    );
    expect(opaque.problem).toMatchObject({ check: "sdk", field: null });
    expectNoSecret(opaque.problem);
  });
});

describe("the startup report carries the problem; doctor runs the owner's checks", () => {
  it("the report decodes a problem and still refuses anything else", () => {
    const problem: PiSourceProblem = {
      file: "models.json",
      check: "schema",
      field: "providers.zai.compat.reasoningEffortMap",
      reason: "was replaced",
    };
    const report = startupReport(
      new StartupRefusal("corrupt-selected", "pi-models", false, problem),
    );
    expect(report).toEqual({
      status: "refused",
      error: "corrupt-selected",
      stage: "pi-models",
      problem,
    });
    expect(decodeStartupReport(JSON.parse(JSON.stringify(report)))).toEqual(
      report,
    );
    for (const bad of [
      { ...report, problem: "x" },
      { ...report, problem: { ...problem, file: "other.json" } },
      { ...report, problem: { ...problem, reason: "line\nbreak" } },
      { ...report, problem: { ...problem, extra: 1 } },
      { ...report, detail: "x" },
    ])
      expect(() => decodeStartupReport(bad)).toThrow();
  });
  function quietly<T>(
    run: () => Promise<T>,
  ): Promise<{ result: T; text: string }> {
    const write = process.stderr.write;
    let text = "";
    process.stderr.write = ((chunk: string) => {
      text += chunk;
      return true;
    }) as typeof process.stderr.write;
    return run()
      .then((result) => ({ result, text }))
      .finally(() => {
        process.stderr.write = write;
        process.exitCode = 0;
      });
  }
  async function doctorPi(agentDir: string) {
    const dir = dirname(agentDir);
    const state = join(dir, "state"),
      workspace = join(dir, "project");
    mkdirSync(state, { mode: 0o700, recursive: true });
    mkdirSync(workspace, { recursive: true });
    const { result, text } = await quietly(() =>
      doctor({
        fix: false,
        yes: false,
        stateHome: state,
        serverConfig: join(state, "none.env"),
        workspace,
        agentDir,
        probeProject: async () => false,
        probeWorkbench: async () => false,
      }),
    );
    const pi = result as {
      status: string;
      pi: (StartupReport & { agentDir: string; targets: string[] })[];
    };
    expect(pi.pi).toHaveLength(1);
    const { agentDir: _a, targets, ...report } = pi.pi[0];
    expect(targets).toEqual([
      expect.stringMatching(/^project /),
      "new projects",
    ]);
    return { status: pi.status, report, text };
  }
  /** Exactly what the owner reports when its pre-bind check refuses. */
  function ownerReport(agentDir: string): StartupReport | { status: "ok" } {
    try {
      preflightPi(agentDir, dirname(agentDir), {});
      return { status: "ok" };
    } catch (error) {
      return startupReport(error);
    }
  }
  it("doctor reports what the owner's pre-bind check would, for every failure kind", async () => {
    const broken: [string, () => string][] = [
      [
        "reasoningEffortMap",
        () =>
          agent(zai({ compat: { reasoningEffortMap: { high: "high" } } }))
            .agentDir,
      ],
      [
        "wrong type",
        () => agent(zai({ compat: { zaiToolStream: SECRET } })).agentDir,
      ],
      ["bad JSON", () => agent(`{"apiKey": "${SECRET}"`).agentDir],
      [
        "command key",
        () =>
          agent(zai(), { zai: { type: "api_key", key: `!${SECRET}` } })
            .agentDir,
      ],
      [
        "symlinked models.json",
        () => {
          const { dir, agentDir } = agent();
          writeFileSync(join(dir, "m.json"), JSON.stringify(zai()));
          symlinkSync(join(dir, "m.json"), join(agentDir, "models.json"));
          return agentDir;
        },
      ],
      [
        "missing auth.json",
        () => {
          const { dir, agentDir } = agent(zai());
          renameSync(join(agentDir, "auth.json"), join(dir, "a"));
          return agentDir;
        },
      ],
    ];
    for (const [name, make] of broken) {
      const agentDir = make();
      const owner = ownerReport(agentDir);
      expect(owner, name).toMatchObject({ status: "refused" });
      const seen = await doctorPi(agentDir);
      expect(seen.report, name).toEqual(owner);
      expect(seen.status, name).toBe("attention");
      expect(seen.text).toContain(
        describePiProblem((owner as StartupReport).problem as PiSourceProblem),
      );
      expect(seen.text).not.toContain(SECRET);
    }
  });
  it("a usable configuration, zaiToolStream included, is OK in both", async () => {
    const { agentDir } = agent(zai({ compat: { zaiToolStream: true } }));
    expect(ownerReport(agentDir)).toEqual({ status: "ok" });
    const seen = await doctorPi(agentDir);
    expect(seen.report).toEqual({ status: "ok" });
    expect(seen.status).toBe("ok");
    expect(seen.text).toContain("Pi model sources");
  });
  it("doctor states that SDK model loading runs only when an owner starts", async () => {
    const { text } = await doctorPi(agent(zai()).agentDir);
    expect(text).toContain(
      "the SDK's model loading runs only when an owner starts",
    );
  });
  // The pinned SDK's own messages, as an owner meets them at pi-runtime: their
  // format is the contract sdkRefusal reduces, so check it against the real SDK.
  it("the pinned SDK's real refusals reduce to the owner's pi-runtime problem", {
    tags: ["slow"],
    timeout: 20000,
  }, async () => {
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const { InMemoryModelsStore } = await import("@earendil-works/pi-ai");
    const sdk = async (models: unknown) => {
      const { agentDir } = agent(models);
      expect(problem(agentDir)).toBeNull();
      const source = piSource(
        agentDir,
        dirname(agentDir),
        dirname(agentDir),
        {},
      );
      const runtime = await ModelRuntime.create({
        authPath: source.authPath,
        modelsPath: source.modelsPath,
        modelsStore: new InMemoryModelsStore(),
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      const refused = runtime.getError();
      return refused ? sdkRefusal(refused).problem : null;
    };
    // Accepted by Cadence's closed check, refused by the SDK's composition.
    expect(
      await sdk({
        providers: {
          custom: { api: "openai-completions", models: [{ id: "m" }] },
        },
      }),
    ).toEqual({
      file: "models.json",
      check: "sdk",
      field: "providers.custom",
      reason: 'defines models but has no "baseUrl"',
    });
    expect(await sdk(zai({ compat: { zaiToolStream: true } }))).toBeNull();
    // The SDK keeps reasoningEffortMap as an inert key; only Cadence refuses it.
    const { agentDir } = agent(
      zai({ compat: { reasoningEffortMap: { high: "high" } } }),
    );
    expect(problem(agentDir)?.field).toContain("reasoningEffortMap");
  });
});
