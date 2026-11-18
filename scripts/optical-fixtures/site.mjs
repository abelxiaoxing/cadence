import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { AUTH_PAGE_CSP, renderAuthPage } from "../../src/service/auth-page.ts";
import { browserIdentity, digest } from "../build-identity.mjs";
import {
  artifact,
  catalog,
  change,
  controlContext,
  csrf,
  cwd,
  diffText,
  epoch,
  events,
  project,
  readRecord,
  storeId,
  workspaceId,
} from "./records.mjs";
export function fixture(root) {
  const dir = join(root, "web/dist"),
    manifest = JSON.parse(readFileSync(join(dir, "manifest.json"))),
    identity = browserIdentity(root);
  if (manifest.buildId !== identity.buildId) throw Error("web-build-stale");
  const assets = new Map(
    manifest.assets.map((a) => {
      const b = readFileSync(join(dir, a.name));
      if (digest(b) !== a.sha256) throw Error(`Invalid asset ${a.name}`);
      return ["/" + a.name, b];
    }),
  );
  const build = { contractHash: identity.contractHash, assets: identity };
  const failures = [];
  const snapshot = (scope) => ({
    protocol: 1,
    storeId,
    epoch,
    scope,
    committedSeq: change.committedSeq,
    runs: [],
    context: controlContext(scope.id),
    horizon: {
      policy: "active-and-recent",
      historicalRuns: {
        reader: "runs",
        storeId,
        scope,
        snapshotSeq: change.committedSeq,
        after: null,
        limit: 50,
      },
    },
  });
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1"),
      p = u.pathname;
    const respond = (status, type, body) => {
      res.writeHead(status, {
        "content-type": type,
        "cache-control": "no-store",
      });
      res.end(body);
    };
    const json = (v) => respond(200, "application/json", JSON.stringify(v));
    const ok = (value) => json({ kind: "ok", value });
    const refuse = () =>
      respond(
        403,
        "application/json",
        JSON.stringify({
          kind: "error",
          error: { code: "forbidden", effect: "none", recovery: "operator" },
        }),
      );
    if (req.method === "POST" && p.endsWith("/detach")) return ok(null);
    if (req.method !== "GET") {
      failures.push(`${req.method} ${p}`);
      return refuse();
    }
    if (p === "/login") {
      res.setHeader("content-security-policy", AUTH_PAGE_CSP);
      return respond(
        401,
        "text/html",
        renderAuthPage({
          authError: u.searchParams.has("error"),
          nextPath: "/app",
        }),
      );
    }
    if (p === "/app") {
      res.setHeader(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
      return respond(200, "text/html", assets.get("/index.html"));
    }
    if (assets.has(p))
      return respond(
        200,
        p.endsWith(".js")
          ? "text/javascript"
          : p.endsWith(".css")
            ? "text/css"
            : "application/octet-stream",
        assets.get(p),
      );
    if (p === "/workbench/v1")
      return json({
        kind: "workbench",
        epoch,
        csrf,
        home: cwd,
        projects: [{ id: project, path: cwd, cwd, epoch }],
        recoveries: [],
        build,
      });
    if (p === "/workbench/v1/service")
      return json({
        kind: "service",
        version: "1.0.0",
        unit: null,
        upgrade: "unsupported-install",
        work: null,
        job: null,
      });
    if (p === "/workbench/v1/models") return json(catalog);
    if (p === "/workbench/v1/activity")
      return json({
        kind: "activity-discovery",
        epoch,
        observedAt: 1,
        completeness: "complete",
        unavailable: 0,
        projects: [],
      });
    if (p === "/workbench/v1/directories")
      return json(readRecord({ kind: "directories", path: cwd }));
    if (p === `/workbench/v1/projects/${project}`)
      return json({
        kind: "project-observation",
        status: "running",
        epoch,
        workspaceId,
      });
    const q = JSON.parse(u.searchParams.get("request") ?? "null");
    if (p.endsWith("/session")) {
      res.setHeader(
        "x-cadence-attachment",
        req.headers["x-cadence-attachment"],
      );
      return ok({
        build,
        protocol: 1,
        storeId,
        epoch,
        accessGeneration: 1,
        authority: "browser",
        csrf,
        capabilities: { actions: false, manualChecks: false, history: true },
      });
    }
    if (p.endsWith("/workspace"))
      return ok({
        storeId,
        workspaceId,
        epoch,
        committedSeq: change.committedSeq,
        rootLabel: cwd,
        context: controlContext(),
        models: [],
      });
    if (p.endsWith("/active-runs"))
      return ok({ storeId, workspaceId, epoch, status: "complete", runs: [] });
    if (p.endsWith("/snapshot")) return ok(snapshot(q));
    if (p.endsWith("/workbench/read")) {
      const v = readRecord(q);
      if (v) return ok(v);
    }
    if (p.endsWith("/details") && q?.recordId === artifact.recordId)
      return ok({
        cursor: q,
        content: artifact,
        text: diffText,
        range: { start: 0, end: artifact.bytes },
        next: null,
        coverage: {
          observed: "complete",
          source: "complete",
          redacted: false,
          omissions: [],
        },
      });
    if (q?.reader)
      return ok({
        request: { ...q, snapshotSeq: change.committedSeq },
        records:
          q.reader === "events"
            ? events
            : q.reader === "changes"
              ? [change]
              : [],
        next: null,
        coverage: {
          observed: "complete",
          source: "complete",
          redacted: false,
          omissions: [],
        },
      });
    refuse();
  });
  const ws = new WebSocketServer({ server });
  ws.on("connection", (socket) =>
    socket.on("message", (data) => {
      const m = JSON.parse(data);
      if (m.scope)
        socket.send(
          JSON.stringify({ kind: "snapshot", snapshot: snapshot(m.scope) }),
        );
    }),
  );
  return {
    build: identity,
    failures,
    async open() {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      for (const s of ws.clients) s.terminate();
      ws.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
