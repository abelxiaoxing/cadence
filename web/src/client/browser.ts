import { ServiceClient } from "../../../src/service-client.ts";
import { HttpServiceTransport } from "../../../src/service-http-client.ts";
import { localBuild } from "./build-identity";
/** Server completes token bootstrap before serving this application. No JS token store. */
export function browserClient(project?: string) {
  const transport = new HttpServiceTransport({
    origin: window.location.origin,
    ...(project ? { project } : {}),
    ...(localBuild
      ? { build: { kind: "browser" as const, ...localBuild } }
      : {}),
    socket: (url) => new WebSocket(url),
  });
  return { client: new ServiceClient(transport), transport };
}
export type BrowserClient = ReturnType<typeof browserClient>;
