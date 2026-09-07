import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PackageContext } from "./model-source.ts";

/** Project only the model capabilities used by the control services. */
export function packageContext(
  context: Pick<ExtensionContext, "cwd" | "model" | "modelRegistry">,
): PackageContext {
  return {
    cwd: context.cwd,
    get model() {
      return context.model;
    },
    modelRegistry: {
      getProvider: (id) => context.modelRegistry.getProvider(id),
      getApiKeyAndHeaders: (model) =>
        context.modelRegistry.getApiKeyAndHeaders(model),
    },
  };
}
