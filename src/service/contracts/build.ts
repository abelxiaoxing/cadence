/** Compatibility is independent of authentication and of task confirmation. */
import { closed, decodeHash, oneOf } from "./core.ts";
export interface BrowserBuild {
  sourceHash: string;
  contractHash: string;
  buildId: string;
}
export type ClientBuild =
  | { kind: "native"; contractHash: string }
  | ({ kind: "browser" } & BrowserBuild);
export interface ServiceBuild {
  contractHash: string;
  assets: BrowserBuild;
}
export function decodeBrowserBuild(value: unknown): BrowserBuild {
  const o = closed(value, ["sourceHash", "contractHash", "buildId"]);
  return {
    sourceHash: decodeHash(o.sourceHash),
    contractHash: decodeHash(o.contractHash),
    buildId: decodeHash(o.buildId),
  };
}
export function decodeClientBuild(value: unknown): ClientBuild {
  const kind = oneOf(
    Object.getOwnPropertyDescriptor(value ?? {}, "kind")?.value,
    ["native", "browser"],
  );
  const o = closed(
    value,
    kind === "native"
      ? ["kind", "contractHash"]
      : ["kind", "contractHash", "sourceHash", "buildId"],
  );
  return kind === "native"
    ? { kind, contractHash: decodeHash(o.contractHash) }
    : {
        kind,
        ...decodeBrowserBuild({
          contractHash: o.contractHash,
          sourceHash: o.sourceHash,
          buildId: o.buildId,
        }),
      };
}
export function decodeServiceBuild(value: unknown): ServiceBuild {
  const o = closed(value, ["contractHash", "assets"]);
  return {
    contractHash: decodeHash(o.contractHash),
    assets: decodeBrowserBuild(o.assets),
  };
}
export function compatibleBuild(
  server: ServiceBuild | undefined,
  client: ClientBuild | null,
  safety = false,
): boolean {
  return (
    !!server &&
    !!client &&
    client.contractHash === server.contractHash &&
    (safety ||
      (server.assets.contractHash === server.contractHash &&
        (client.kind === "native" ||
          (client.buildId === server.assets.buildId &&
            client.sourceHash === server.assets.sourceHash))))
  );
}
