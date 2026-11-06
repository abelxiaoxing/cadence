import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import {
  assertReleaseCheckout,
  assertUnpublished,
  confirmPublished,
  registryVersion,
  releaseArchive,
  releaseVersion,
} from "../scripts/npm-release.mjs";
import { header } from "./helpers/tar-fixture.mjs";

const name = "@abelxiaoxing/cadence";
const version = "2.0.39";
const pkg = {
  name,
  version,
  repository: { url: "git+https://github.com/abelxiaoxing/cadence.git" },
};
const env = {
  GITHUB_REPOSITORY: "abelxiaoxing/cadence",
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: `refs/tags/v${version}`,
  GITHUB_SHA: "a".repeat(40),
};
const event = {
  ref: env.GITHUB_REF,
  created: true,
  deleted: false,
  forced: false,
};
const roots = [];
function temp() {
  const root = mkdtempSync(join(tmpdir(), "cadence-release-test-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("admits only an exact stable release tag for this public package", () => {
  expect(releaseVersion(pkg, env, event)).toBe(version);
});
it.each([
  [{}, { GITHUB_REPOSITORY: "another/cadence" }, {}],
  [{}, { GITHUB_EVENT_NAME: "workflow_dispatch" }, {}],
  [{}, { GITHUB_EVENT_NAME: "pull_request" }, {}],
  [{}, { GITHUB_REF: "refs/heads/main" }, {}],
  [{}, { GITHUB_SHA: "main" }, {}],
  [{}, {}, { ref: "refs/tags/v2.0.40" }],
  [{}, {}, { created: false }],
  [{}, {}, { deleted: true }],
  [{}, {}, { forced: true }],
  [{}, {}, { forced: undefined }],
  [{ version: "2.0.40" }, {}, {}],
  [{ name: "another-package" }, {}, {}],
  [
    { repository: { url: "git+https://github.com/another/cadence.git" } },
    {},
    {},
  ],
  [{ private: true }, {}, {}],
  [{ publishConfig: { registry: "https://other.invalid" } }, {}, {}],
])(
  "refuses mismatched identity, trigger or publication overrides %#",
  (p, e, hook) => {
    expect(() =>
      releaseVersion({ ...pkg, ...p }, { ...env, ...e }, { ...event, ...hook }),
    ).toThrow("npm-release-");
  },
);
it.each([
  "2.0.39-beta.1",
  "2.0.39+build",
  "02.0.39",
  "2.0",
  "2.0.39\n",
  "$(echo bad)",
])("never treats %s as a stable latest release", (value) => {
  const ref = `refs/tags/v${value}`;
  expect(() =>
    releaseVersion(
      { ...pkg, version: value },
      { ...env, GITHUB_REF: ref },
      { ...event, ref },
    ),
  ).toThrow("stable-tag-version-mismatch");
});

function git(root, ...args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      ...args,
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}
function repositoryFixture(annotated) {
  const root = temp();
  const upstream = join(root, "upstream");
  mkdirSync(upstream);
  git(upstream, "init", "-q", "-b", "main");
  writeFileSync(join(upstream, "package.json"), JSON.stringify(pkg));
  git(upstream, "add", "package.json");
  // commit-tree creates only this fabricated fixture's objects, without hooks.
  const tree = git(upstream, "write-tree");
  const first = git(upstream, "commit-tree", tree, "-m", "fixture base");
  const second = git(
    upstream,
    "commit-tree",
    tree,
    "-p",
    first,
    "-m",
    "fixture release",
  );
  git(upstream, "update-ref", "refs/heads/main", second);
  const args = annotated ? ["-a", "-m", "fixture tag"] : [];
  git(upstream, "tag", ...args, `v${version}`, second);
  const checkout = join(root, "checkout");
  git(root, "clone", "-q", "--no-local", upstream, checkout);
  return { upstream, checkout, first, second };
}
it.each([false, true])(
  "binds actual Git ancestry and tag identity (annotated=%s)",
  (annotated) => {
    const f = repositoryFixture(annotated);
    const context = { ...env, GITHUB_SHA: f.second };
    expect(assertReleaseCheckout(f.checkout, context)).toBe(f.second);
    if (annotated)
      expect(
        assertReleaseCheckout(f.checkout, {
          ...context,
          GITHUB_SHA: git(f.checkout, "rev-parse", env.GITHUB_REF),
        }),
      ).toBe(f.second);
    expect(() =>
      assertReleaseCheckout(f.checkout, { ...context, GITHUB_SHA: f.first }),
    ).toThrow("checkout-mismatch");
    writeFileSync(join(f.checkout, "extra.txt"), "user work");
    expect(() => assertReleaseCheckout(f.checkout, context)).toThrow(
      "dirty-checkout",
    );
  },
);
it("refuses a tag whose commit is not on main", () => {
  const f = repositoryFixture(false);
  git(f.upstream, "update-ref", "refs/heads/main", f.first);
  // A fresh clone observes the actual rewritten upstream, not a stale tracking ref.
  const checkout = join(temp(), "outside-main");
  git(f.upstream, "clone", "-q", "--no-local", f.upstream, checkout);
  git(checkout, "switch", "--detach", `v${version}`);
  expect(() =>
    assertReleaseCheckout(checkout, { ...env, GITHUB_SHA: f.second }),
  ).toThrow();
});
it("does not force-fetch a moved tag", () => {
  const f = repositoryFixture(false);
  git(f.upstream, "update-ref", env.GITHUB_REF, f.first);
  expect(() =>
    assertReleaseCheckout(f.checkout, { ...env, GITHUB_SHA: f.second }),
  ).toThrow();
  expect(git(f.checkout, "rev-parse", env.GITHUB_REF)).toBe(f.second);
});

it("refuses duplicates and downgrades, comparing semver parts numerically", () => {
  expect(() =>
    assertUnpublished("2.10.0", { name, version: "2.9.9" }, null),
  ).not.toThrow();
  expect(() =>
    assertUnpublished(version, { name, version: "2.0.38" }, { name, version }),
  ).toThrow("already-published");
  for (const latest of [version, "2.0.40", "3.0.0"])
    expect(() =>
      assertUnpublished(version, { name, version: latest }, null),
    ).toThrow("not-newer");
  expect(() =>
    assertUnpublished(version, { name: "other", version: "2.0.38" }, null),
  ).toThrow("registry-package");
  expect(() =>
    assertUnpublished(version, { name, version: "2.1.0-beta.1" }, null),
  ).toThrow("invalid-latest");
});
it("only an explicit candidate-version 404 means unused; auth, server and malformed responses fail closed", async () => {
  const missing = vi.fn(async () => new Response("{}", { status: 404 }));
  await expect(registryVersion(version, true, missing)).resolves.toBeNull();
  await expect(registryVersion("latest", false, missing)).rejects.toThrow(
    "http-404",
  );
  for (const status of [401, 403, 429, 500]) {
    const response = new Response("{}", { status });
    await expect(
      registryVersion(version, true, async () => response),
    ).rejects.toThrow(`http-${status}`);
    expect(response.bodyUsed).toBe(true);
  }
  for (const body of [
    {},
    { name: "other", version },
    { name, version: "2.0.38" },
  ])
    await expect(
      registryVersion(version, true, async () => Response.json(body)),
    ).rejects.toThrow("registry-version-identity");
  const ok = vi.fn(async () => Response.json({ name, version }));
  await expect(registryVersion(version, false, ok)).resolves.toEqual({
    name,
    version,
  });
  expect(ok.mock.calls[0][0]).toBe(
    `https://registry.npmjs.org/@abelxiaoxing%2fcadence/${version}`,
  );
  expect(ok.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    cache: "no-store",
  });
  expect(ok.mock.calls[0][1]).not.toHaveProperty("headers.Authorization");
});

const digest = (algorithm, bytes, encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
function archiveFixture() {
  const root = temp();
  mkdirSync(join(root, "agents"));
  mkdirSync(join(root, "provenance"));
  const roles = [
    "design-explorer",
    "implementation-worker",
    "diagnosis-worker",
  ];
  const bodies = { "notice.txt": "fixture notice" };
  let pins = "agents:\n";
  for (const role of roles) {
    bodies[`agents/${role}.md`] = role;
    pins += `  - path: agents/${role}.md\n    role: ${role}\n    sha256: ${digest("sha256", role)}\n`;
  }
  for (const [path, body] of Object.entries(bodies))
    writeFileSync(join(root, path), body);
  writeFileSync(
    join(root, "provenance/package-members.json"),
    JSON.stringify(Object.keys(bodies).map((path) => `package/${path}`)),
  );
  writeFileSync(join(root, "provenance/adapted-modules.yaml"), pins);
  writeFileSync(
    join(root, "provenance/bundled-notices.json"),
    JSON.stringify({
      noticeFile: "notice.txt",
      noticeSha256: digest("sha256", bodies["notice.txt"]),
      fonts: [],
    }),
  );
  const directory = temp();
  const bytes = gzipSync(
    Buffer.concat([
      ...Object.entries(bodies).map(([path, body]) =>
        header(`package/${path}`, 48, body),
      ),
      Buffer.alloc(1024),
    ]),
  );
  writeFileSync(join(directory, `abelxiaoxing-cadence-${version}.tgz`), bytes);
  return { root, directory, bytes };
}
it("audits exact source bytes and the transport digest, not only a tarball filename", () => {
  const f = archiveFixture();
  const artifact = releaseArchive(f.root, f.directory, version);
  expect(artifact.bytes).toEqual(f.bytes);
  expect(artifact.sha256).toBe(digest("sha256", f.bytes));
  expect(
    releaseArchive(f.root, f.directory, version, artifact.sha256).integrity,
  ).toBe(`sha512-${digest("sha512", f.bytes, "base64")}`);
  expect(() =>
    releaseArchive(f.root, f.directory, version, "0".repeat(64)),
  ).toThrow("transport-digest");
  expect(() => releaseArchive(f.root, f.directory, version, "")).toThrow(
    "transport-digest",
  );
  writeFileSync(join(f.root, "notice.txt"), "tampered");
  expect(() => releaseArchive(f.root, f.directory, version)).toThrow(
    "body-drift",
  );
  writeFileSync(join(f.directory, "extra.tgz"), "unreviewed");
  expect(() => releaseArchive(f.root, f.directory, version)).toThrow(
    "archive-file-set",
  );
});

function registryFixture(overrides = {}) {
  const bytes = Buffer.from("audited release bytes");
  const artifact = {
    bytes,
    shasum: digest("sha1", bytes),
    integrity: `sha512-${digest("sha512", bytes, "base64")}`,
  };
  const tarball = `https://registry.npmjs.org/${name}/-/cadence-${version}.tgz`;
  const metadata = {
    name,
    version,
    dist: { shasum: artifact.shasum, integrity: artifact.integrity, tarball },
  };
  const fetcher = vi.fn(async (url) => {
    if (url.endsWith(".tgz")) return new Response(overrides.bytes ?? bytes);
    if (url.endsWith("/latest"))
      return Response.json({ name, version: overrides.latest ?? version });
    return overrides.missing
      ? new Response("{}", { status: 404 })
      : Response.json({ ...metadata, ...overrides.metadata });
  });
  return { artifact, metadata, fetcher };
}
it("confirms both registry digests, latest and actually downloaded bytes without any write request", async () => {
  const f = registryFixture();
  await confirmPublished(version, f.artifact, f.fetcher);
  expect(f.fetcher).toHaveBeenCalledTimes(3);
  for (const [, options] of f.fetcher.mock.calls)
    expect(options.method).toBeUndefined();
});
it("bounded readonly observations tolerate initial propagation, never replaying publication", async () => {
  const f = registryFixture();
  f.fetcher.mockImplementationOnce(
    async () => new Response("{}", { status: 404 }),
  );
  f.fetcher.mockImplementationOnce(async () =>
    Response.json({ name, version: "2.0.38" }),
  );
  const sleep = vi.fn(async () => {});
  await confirmPublished(version, f.artifact, f.fetcher, sleep);
  expect(sleep).toHaveBeenCalledOnce();
  const missing = registryFixture({ missing: true, latest: "2.0.38" });
  sleep.mockClear();
  await expect(
    confirmPublished(version, missing.artifact, missing.fetcher, sleep),
  ).rejects.toThrow("publication-not-visible");
  expect(sleep).toHaveBeenCalledTimes(5);
  expect(missing.fetcher).toHaveBeenCalledTimes(12);
});
it.each(["digest", "url", "short", "long", "same-size", "latest"])(
  "refuses published %s mismatches without repairing the registry",
  async (kind) => {
    const f = registryFixture();
    const options =
      kind === "digest"
        ? {
            metadata: {
              dist: { ...f.metadata.dist, integrity: "sha512-wrong" },
            },
          }
        : kind === "url"
          ? {
              metadata: {
                dist: {
                  ...f.metadata.dist,
                  tarball: "https://other.invalid/package.tgz",
                },
              },
            }
          : kind === "latest"
            ? { latest: "2.0.40" }
            : {
                bytes:
                  kind === "short"
                    ? Buffer.from("short")
                    : Buffer.alloc(
                        f.artifact.bytes.length + (kind === "long" ? 1 : 0),
                      ),
              };
    const bad = registryFixture(options);
    await expect(
      confirmPublished(version, bad.artifact, bad.fetcher),
    ).rejects.toThrow("npm-release-");
    expect(bad.fetcher.mock.calls.length).toBeLessThanOrEqual(3);
  },
);

it("the parsed workflow isolates OIDC, pins actions and transports only the audited artifact", () => {
  const root = resolve(import.meta.dirname, "..");
  const file = join(root, ".github/workflows/publish.yml");
  const workflow = JSON.parse(
    execFileSync(
      "bun",
      [
        "-e",
        "console.log(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))",
        file,
      ],
      { encoding: "utf8" },
    ),
  );
  expect(workflow.on).toEqual({ push: { tags: ["v*"] } });
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.concurrency).toEqual({
    group: "npm-release",
    "cancel-in-progress": false,
  });
  const { prepare, publish } = workflow.jobs;
  expect(prepare.if).toContain("github.repository == 'abelxiaoxing/cadence'");
  expect(prepare.if).toContain("!github.event.forced");
  expect(prepare.permissions).toBeUndefined();
  expect(publish.needs).toBe("prepare");
  expect(publish.environment).toBe("npm-release");
  expect(publish.permissions).toEqual({
    contents: "read",
    "id-token": "write",
  });
  const runs = (job) =>
    job.steps
      .filter((s) => s.run)
      .map((s) => s.run)
      .join("\n");
  expect(runs(prepare)).toContain("bun run verify");
  expect(runs(prepare)).toContain("bun install --frozen-lockfile");
  expect(runs(prepare)).toContain(
    'bun pm pack --destination "$TMPDIR/release"',
  );
  expect(runs(publish)).not.toMatch(/bun |npm (install|ci|run|stage)|build:/);
  expect(runs(publish).match(/npm publish/g)).toHaveLength(1);
  expect(runs(publish)).toContain(
    "--ignore-scripts --registry https://registry.npmjs.org",
  );
  const fetchArtifact = publish.steps.find((s) =>
    s.uses?.startsWith("actions/download-artifact@"),
  );
  expect(fetchArtifact.with["artifact-ids"]).toBe(
    `\${{ needs.prepare.outputs.artifact-id }}`,
  );
  expect(fetchArtifact.with["digest-mismatch"]).toBe("error");
  expect(publish.env.RELEASE_SHA256).toBe(
    `\${{ needs.prepare.outputs.sha256 }}`,
  );
  expect(runs(publish)).toContain('audit "$TMPDIR/release" "$RELEASE_SHA256"');
  const index = (job, text) =>
    job.steps.findIndex((s) => (s.run ?? s.uses ?? "").includes(text));
  expect(index(prepare, "preflight")).toBeLessThan(
    index(prepare, "bun install"),
  );
  expect(index(prepare, "bun run verify")).toBeLessThan(
    index(prepare, "bun pm pack"),
  );
  expect(index(prepare, "bun pm pack")).toBeLessThan(
    index(prepare, "npm-release.mjs audit"),
  );
  expect(index(prepare, "npm-release.mjs audit")).toBeLessThan(
    index(prepare, "actions/upload-artifact@"),
  );
  expect(index(publish, "preflight")).toBeLessThan(
    index(publish, "npm publish"),
  );
  expect(index(publish, "actions/download-artifact@")).toBeLessThan(
    index(publish, "npm-release.mjs audit"),
  );
  expect(index(publish, "npm-release.mjs audit")).toBeLessThan(
    index(publish, "npm publish"),
  );
  expect(index(publish, "npm publish")).toBeLessThan(
    index(publish, "npm-release.mjs confirm"),
  );
  expect(publish.steps.at(-1).if).toContain(
    "steps.publish.outcome == 'failure'",
  );
  for (const job of [prepare, publish]) {
    expect(job["runs-on"]).toBe("ubuntu-24.04");
    expect(runs(job)).toContain("umask 077");
    expect(runs(job)).toContain(
      'mktemp -d "$RUNNER_TEMP/cadence-release.XXXXXXXX"',
    );
    expect(runs(job)).toContain("TMPDIR=%s\\nTEMP=%s\\nTMP=%s\\n");
    expect(runs(job)).toContain("node scripts/npm-release.mjs preflight");
    for (const step of job.steps.filter((s) => s.uses)) {
      expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
      if (step.uses.startsWith("actions/checkout@")) {
        expect(step.with.ref).toBe(`\${{ github.sha }}`);
        expect(step.with["persist-credentials"]).toBe(false);
      }
    }
  }
  expect(readFileSync(file, "utf8")).not.toMatch(
    /secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|tags-filter=slow|workflow_dispatch|pull_request/,
  );
});
