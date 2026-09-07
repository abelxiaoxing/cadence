import type { Model, Provider } from "@earendil-works/pi-ai";

/** Code-owned capability boundary. No session events, tools, UI or host context. */
export interface ParentModelSource {
  readonly model?: Model<string>;
  readonly modelRegistry: {
    getProvider(id: string): Provider | undefined;
    getApiKeyAndHeaders(model: Model<string>): Promise<
      | {
          ok: true;
          apiKey?: string;
          headers?: Record<string, string | null>;
          baseUrl?: string;
          env?: Record<string, string>;
        }
      | { ok: false }
    >;
  };
}
export interface PackageContext extends ParentModelSource {
  readonly cwd: string;
}
