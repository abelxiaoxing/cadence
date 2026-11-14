import {
  decodeModelPreview,
  type ModelPreview,
} from "../../../src/service/contracts/models.ts";
import { errorCode, readJson } from "./service";
export type PreviewModels = (signal?: AbortSignal) => Promise<ModelPreview>;
/** Authenticated discovery only; no attachment, CSRF, preparation or model write. */
export async function readModelPreview(
  project?: string,
  signal?: AbortSignal,
): Promise<ModelPreview> {
  const response = await fetch(
    `/workbench/v1/models${project ? `?project=${encodeURIComponent(project)}` : ""}`,
    {
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      signal,
    },
  );
  const value = await readJson(response);
  if (!response.ok) throw new Error(errorCode(value));
  return decodeModelPreview(value);
}
