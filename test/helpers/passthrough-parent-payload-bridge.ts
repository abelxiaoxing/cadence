import type { Model } from "@earendil-works/pi-ai";
import {
  type ParentModelKey,
  ParentPayloadBridge,
  type ParentPayloadCallback,
  type ParentPayloadCapture,
  type ParentProviderRegistry,
} from "../../src/parent-payload-bridge.ts";

export class PassthroughParentPayloadBridge extends ParentPayloadBridge {
  private readonly captures = new Map<string, ParentPayloadCapture>();

  override capture(
    modelKey: ParentModelKey,
    registry?: Pick<ParentProviderRegistry, "getProvider">,
  ): ParentPayloadCapture | undefined {
    const delegate = registry?.getProvider(modelKey.provider);
    if (!delegate) return undefined;
    const key = JSON.stringify(modelKey);
    const current = this.captures.get(key);
    if (current?.delegate === delegate) return current;
    const capture: ParentPayloadCapture = Object.freeze({
      generation: 1,
      sessionId: "test-session",
      modelKey: Object.freeze({ ...modelKey }),
      delegate,
      onPayload: (payload: unknown) => payload,
    });
    this.captures.set(key, capture);
    return capture;
  }

  override async composePayload(
    capture: ParentPayloadCapture | undefined,
    payload: unknown,
    model: Model<string>,
    childOnPayload?: ParentPayloadCallback,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    if (!capture) throw new Error("parent payload bridge is unavailable");
    let current = childOnPayload
      ? ((await childOnPayload(payload, model)) ?? payload)
      : payload;
    current = (await capture.onPayload(current, model)) ?? current;
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      throw new Error("parent payload bridge produced an unsafe payload");
    }
    const result = current as Record<string, unknown>;
    if (model.api !== "openai-responses") return result;
    const normalized = { ...result };
    delete normalized.max_output_tokens;
    return normalized;
  }
}
