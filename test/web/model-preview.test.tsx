import { afterEach, expect, it, vi } from "vitest";
import { readModelPreview } from "../../web/src/client/model-preview";

afterEach(() => vi.unstubAllGlobals());
const preview = {
  status: "complete",
  entries: [],
  remembered: null,
  withheld: 0,
};
it.each([undefined, "a".repeat(64)])(
  "reads the model preview for %s without preparation or a model command",
  async (project) => {
    const fetcher = vi.fn(async () => Response.json(preview));
    vi.stubGlobal("fetch", fetcher);
    const abort = new AbortController();
    expect(await readModelPreview(project, abort.signal)).toEqual(preview);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `/workbench/v1/models${project ? `?project=${project}` : ""}`,
      {
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: abort.signal,
      },
    );
  },
);
it("refuses forged execution authority or a broken preview rather than falling back to owner startup", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ ...preview, version: { epoch: "invented-owner" } }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(readModelPreview()).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("keeps an authenticated source refusal distinct from an empty model list", async () => {
  const fetcher = vi.fn(async () =>
    Response.json(
      { kind: "error", error: { code: "corrupt-selected" } },
      { status: 409 },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(readModelPreview()).rejects.toThrow("corrupt-selected");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
