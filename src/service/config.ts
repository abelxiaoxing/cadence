import { isIP } from "node:net";
import {
  ContractError,
  closed,
  integer,
  list,
  literal,
  text,
} from "./contracts/core.ts";

/** Secret-free, explicitly selected inbound policy. No environment discovery. */
export interface HttpPolicy {
  schema: "cadence-service-http/1";
  host: "127.0.0.1" | "::1";
  port: number;
  proxy: null | { origin: string; trustedAddresses: string[] };
}
export function decodeHttpPolicy(value: unknown): HttpPolicy {
  const o = closed(value, ["schema", "host", "port", "proxy"]);
  if (o.host !== "127.0.0.1" && o.host !== "::1")
    throw new ContractError("invalid");
  let proxy: HttpPolicy["proxy"] = null;
  if (o.proxy !== null) {
    const p = closed(o.proxy, ["origin", "trustedAddresses"]);
    const origin = text(p.origin, 256, true);
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new ContractError("invalid");
    }
    if (
      url.protocol !== "https:" ||
      url.origin !== origin ||
      url.username ||
      url.password
    )
      throw new ContractError("invalid");
    const trustedAddresses = list(p.trustedAddresses, 8, (v) => {
      const address = text(v, 64, true);
      // Backend/proxy are on the same host; no DNS, wildcard or proxy chains.
      if (!isIP(address) || !loopbackAddress(address))
        throw new ContractError("invalid");
      return address;
    });
    if (
      !trustedAddresses.length ||
      new Set(trustedAddresses).size !== trustedAddresses.length
    )
      throw new ContractError("invalid");
    proxy = { origin, trustedAddresses };
  }
  return {
    schema: literal(o.schema, "cadence-service-http/1"),
    host: o.host,
    port: integer(o.port, 0, 65535),
    proxy,
  };
}
/** Adapted numeric-only subset of pi-web-ui server/host-guard.ts (MIT).
 * DNS localhost/private-LAN fallbacks and token Host bypass intentionally removed. */
export function loopbackAddress(host: string): boolean {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  const h = mapped ? mapped[1] : host;
  if (h.includes(":")) return h === "::1";
  const parts = h.split(".");
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255) &&
    Number(parts[0]) === 127
  );
}
export function localOrigin(policy: HttpPolicy, actualPort: number): string {
  integer(actualPort, 1, 65535);
  return `http://${policy.host === "::1" ? "[::1]" : policy.host}:${actualPort}`;
}
