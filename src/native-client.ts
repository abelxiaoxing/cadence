/** Native attachment only. No SDK/auth resolution, worker or storage mutation. */

import { Agent, Dispatcher1Wrapper } from "undici";
import { nativeBuild } from "./native-build.ts";
import { ServiceCoordination } from "./service/coordination.ts";
import { ServiceClient } from "./service-client.ts";
import {
  ContractError,
  compatibleBuild,
  type SessionBootstrap,
} from "./service-contract.ts";
import { HttpServiceTransport } from "./service-http-client.ts";

export const MANAGEMENT_GUIDANCE =
  "Cadence owner absent, unavailable or incompatible. Explicitly run cadence-service status --workspace <path>, cadence-service diagnose --workspace <path>, or cadence-service start --workspace <path>. Stop older Cadence sessions first. For retained fences use cadence-service recover inspect; resolve requires a local terminal and separate process, credential and storage acknowledgments. Never treat unavailable/quarantined as stopped. No service was started and no embedded executor is available.";

export class NativeConnection {
  private transport?: HttpServiceTransport;
  private network?: Agent;
  private networkClose?: Promise<void>;
  private closing?: Promise<void>;
  private allocating?: Promise<void>;
  client?: ServiceClient;
  session?: SessionBootstrap;
  private epoch?: string;

  async attach(cwd: string): Promise<ServiceClient> {
    // Failed detach keeps its exact transport/slot. Explicit re-entry may retry
    // detach, but never forget it and allocate a replacement on uncertainty.
    await this.detach();
    const access = new ServiceCoordination(cwd).localAccess();
    this.epoch = access.epoch;
    const network = new Agent();
    this.network = network;
    // Node 22/24 built-in fetch bundles undici 6/7, whose legacy handlers an
    // undici 8 Agent rejects. The public wrapper adapts them on every line.
    const dispatcher = new Dispatcher1Wrapper(network);
    this.transport = new HttpServiceTransport({
      origin: access.endpoint,
      localCapability: access.capability,
      build: nativeBuild,
      // Bound finite requests, not the entire streaming archive. Export keeps
      // caller cancellation and the owner's download-idle policy, like WebUI.
      requestTimeoutMs: 10000,
      // Local capability MUST stay on direct numeric loopback even when the Pi
      // process routes provider auth through a proxy. Public per-request Node
      // dispatcher only: never replace/restore the parent's global dispatcher.
      fetch: (url, init) =>
        globalThis.fetch(url, Object.assign({}, init, { dispatcher })),
    });
    const client = new ServiceClient(this.transport);
    this.client = client;
    const allocation = (async () => {
      await this.refresh();
    })();
    this.allocating = allocation;
    try {
      await allocation;
    } finally {
      if (this.allocating === allocation) this.allocating = undefined;
    }
    return client;
  }
  async refresh(): Promise<SessionBootstrap> {
    if (!this.client) throw new ContractError("unavailable");
    const reply = await this.client.session();
    if (reply.kind === "error") throw new ContractError(reply.error.code);
    if (reply.value.authority !== "local" || reply.value.epoch !== this.epoch)
      throw new ContractError("stale");
    this.session = reply.value;
    return reply.value;
  }
  compatible(safety = false): boolean {
    return compatibleBuild(this.session?.build, nativeBuild, safety);
  }
  detach(): Promise<void> {
    if (this.closing) return this.closing;
    const transport = this.transport;
    const network = this.network;
    if (!transport && !network) return Promise.resolve();
    const allocation = this.allocating;
    const closing = (async () => {
      // Track late allocations; a caller's departure isn't evidence of release.
      await allocation?.catch(() => {});
      await transport?.detach();
      if (network) {
        this.networkClose ??= Promise.resolve().then(() => network.close());
        await this.networkClose; // original close; failure retains this exact resource
      }
      if (this.transport === transport && this.network === network) {
        this.network = undefined;
        this.networkClose = undefined;
        this.transport = undefined;
        this.client = undefined;
        this.session = undefined;
      }
    })();
    this.closing = closing;
    void closing
      .finally(() => {
        if (this.closing === closing) this.closing = undefined;
      })
      .catch(() => {});
    return closing;
  }
}
