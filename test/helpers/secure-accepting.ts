/** Actual same-host TLS HTTP/WS proxy around the generated accepting owner. */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer, request as secureRequest } from "node:https";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { acceptingFixture } from "./accepting-fixture.ts";

export function secureAcceptingFixture() {
  return secureFixture((proxy) =>
    acceptingFixture("generated", undefined, proxy),
  );
}
export async function secureFixture<
  T extends { endpoint: string; close(): Promise<unknown> },
>(
  factory: (proxy: {
    origin: string;
    trustedAddresses: string[];
  }) => Promise<T>,
) {
  const root = mkdtempSync(join(tmpdir(), "accepting-tls-"));
  const key = join(root, "key.pem"),
    cert = join(root, "cert.pem");
  const openssl = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { timeout: 10000, encoding: "utf8" },
  );
  if (openssl.status !== 0) throw Error("isolated TLS fixture unavailable");
  const home = join(root, "browser-home"),
    nss = join(home, ".pki/nssdb");
  mkdirSync(nss, { recursive: true, mode: 0o700 });
  // Trust only this fabricated CA in the fresh browser HOME, never a personal store.
  for (const args of [
    ["-N", "--empty-password", "-d", `sql:${nss}`],
    [
      "-A",
      "-d",
      `sql:${nss}`,
      "-n",
      "Cadence isolated CA",
      "-t",
      "C,,",
      "-i",
      cert,
    ],
  ]) {
    const result = spawnSync("certutil", args, {
      encoding: "utf8",
      timeout: 10000,
    });
    if (result.status !== 0) throw Error("isolated browser CA unavailable");
  }
  let target = "",
    origin = "",
    http = 0,
    upgrades = 0;
  const sockets = new Set<Duplex>();
  const headers = (input: Record<string, string | string[] | undefined>) => {
    const out = { ...input };
    for (const k of Object.keys(out))
      if (
        k === "host" ||
        k === "forwarded" ||
        k.startsWith("x-forwarded-") ||
        k === "x-real-ip"
      )
        delete out[k];
    return { ...out, host: new URL(origin).host, "x-forwarded-proto": "https" };
  };
  const proxy = createServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (req, res) => {
      http++;
      const upstream = request(
        `${target}${req.url}`,
        { method: req.method, headers: headers(req.headers), agent: false },
        (reply) => {
          if (reply.statusCode === undefined) {
            reply.destroy();
            res.destroy();
            return;
          }
          res.writeHead(reply.statusCode, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on("error", () => res.destroy());
      res.on("close", () => upstream.destroy());
      req.pipe(upstream);
    },
  );
  proxy.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  proxy.on("upgrade", (req, socket, head) => {
    upgrades++;
    const upstream = connect(Number(new URL(target).port), "127.0.0.1");
    sockets.add(upstream);
    upstream.on("close", () => sockets.delete(upstream));
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.on("connect", () => {
      upstream.write(
        `GET ${req.url} HTTP/1.1\r\n${Object.entries(headers(req.headers))
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n")}\r\n\r\n`,
      );
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const address = proxy.address();
  if (!address || typeof address === "string")
    throw Error("TLS bind unavailable");
  origin = `https://127.0.0.1:${address.port}`;
  const fixture = await factory({
    origin,
    trustedAddresses: ["127.0.0.1"],
  });
  target = fixture.endpoint;
  // Independent CA-validated native request; no rejectUnauthorized=false.
  await new Promise<void>((resolve, reject) => {
    const req = secureRequest(
      `${origin}/healthz`,
      { ca: readFileSync(cert), agent: false },
      (reply) => {
        reply.resume();
        reply.on("end", () =>
          reply.statusCode === 200 ? resolve() : reject(Error("TLS health")),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
  return {
    ...fixture,
    endpoint: origin,
    browserHome: home,
    tlsRoot: root,
    proxyFacts: () => ({
      http,
      upgrades,
      isolatedCa: true,
      tlsVerificationDisabled: false,
    }),
    async close() {
      try {
        return await fixture.close();
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((r) => proxy.close(() => r()));
      }
    },
  };
}
