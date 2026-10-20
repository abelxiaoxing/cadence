/** Private owner-process route. Management stays SDK/Undici-free. */
import {
  networkSnapshot,
  sameNetwork,
  sdkNetworkEnvironment,
} from "../sdk-network.ts";
import { ContractError } from "../service-contract.ts";

export class AuthNetwork {
  private readonly snapshot = networkSnapshot(process.env);
  private readonly selected = sdkNetworkEnvironment(
    this.snapshot,
    networkSnapshot(undefined),
  );
  private owned?: { close(): Promise<void> };
  private getter?: () => unknown;
  private initialized = false;
  private closing?: Promise<void>;
  readonly literals = Object.freeze([...this.selected.redactionLiterals]);
  get mode(): "direct" | "validated-proxy" {
    return this.literals.length ? "validated-proxy" : "direct";
  }
  constructor() {
    // This process must have started with the route, not acquired environment
    // variables after SDK imports. The explicit management launcher supplies both.
    if (
      this.mode === "validated-proxy" &&
      (process.env.NODE_USE_ENV_PROXY !== "1" ||
        !process.execArgv.includes("--use-env-proxy"))
    )
      throw new ContractError("unsupported-context");
  }
  /** Called only after the real SDK imports, before runtime/auth construction. */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.assert({});
      return;
    }
    if (this.closing) throw new ContractError("conflict");
    this.assertFacts();
    if (this.mode === "validated-proxy") {
      try {
        const api = await import("undici");
        this.assertFacts();
        if (
          typeof api.EnvHttpProxyAgent !== "function" ||
          typeof api.setGlobalDispatcher !== "function" ||
          typeof api.getGlobalDispatcher !== "function"
        )
          throw new Error();
        const route = this.literals[0];
        const dispatcher = new api.EnvHttpProxyAgent({
          httpProxy: route,
          httpsProxy: route,
          noProxy: "",
        });
        this.owned = dispatcher; // retain even if setter/getter fails
        this.getter = api.getGlobalDispatcher;
        api.setGlobalDispatcher(dispatcher);
        if (api.getGlobalDispatcher() !== dispatcher) throw new Error();
      } catch {
        // No direct fallback, unowned restoration, raw exception or route output.
        throw new ContractError("unsupported-context");
      }
    }
    this.initialized = true;
    this.assert({});
  }
  private assertFacts(): void {
    if (!sameNetwork(this.snapshot, networkSnapshot(process.env)))
      throw new ContractError("stale");
  }
  assert(scoped: Record<string, string>): void {
    this.assertFacts();
    if (!this.initialized || this.closing)
      throw new ContractError("unavailable");
    try {
      sdkNetworkEnvironment(this.snapshot, networkSnapshot(scoped));
      if (this.owned && this.getter?.() !== this.owned) throw new Error();
    } catch {
      throw new ContractError("unsupported-context");
    }
  }
  /** Original close is part of owner's listener/resource settlement. Never close
   * or restore the previous unowned dispatcher. DIRECT performs no Undici work. */
  close(): Promise<void> {
    if (!this.closing)
      this.closing = Promise.resolve().then(() => this.owned?.close());
    return this.closing;
  }
}
