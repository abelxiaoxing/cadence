import { useEffect, useRef, useState } from "react";
import { ContentExplorer } from "../components/history/ContentExplorer";
import { PageControls } from "../components/history/PageControls";
import { usePage } from "../history/use-page";
import type { HistoryRecord, ListRequest, ServiceClient } from "../types";
import { timelineBridge } from "./timeline-adapter";
export function TimelineView({
  client,
  seed,
  onSearch,
}: {
  client: ServiceClient;
  seed: ListRequest;
  onSearch: () => void;
}) {
  const pager = usePage(client, { ...seed, reader: "events" }),
    page = pager.page;
  return (
    <section className="timeline-view">
      <p>
        Committed order, not wall time. Replay advances visualization only. Raw
        observations retain clock/sequence provenance; unknown timing is not
        reconstructed.
      </p>
      <PageControls pager={pager} />
      {page && !("kind" in page) && (
        <MountedTimeline
          key={`${page.request.snapshotSeq}:${page.request.after?.recordId ?? "first"}`}
          client={client}
          seed={page.request}
          records={page.records}
          onSearch={onSearch}
        />
      )}
    </section>
  );
}
function MountedTimeline({
  client,
  seed,
  records,
  onSearch,
}: {
  client: ServiceClient;
  seed: ListRequest;
  records: HistoryRecord[];
  onSearch: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [fields, setFields] = useState(false),
    [error, setError] = useState(false);
  const searchRef = useRef(onSearch);
  searchRef.current = onSearch;
  useEffect(() => {
    let disposed = false,
      cleanup: (() => void) | undefined;
    void import("./timeline-client.mjs")
      .then((module) => {
        if (disposed || !ref.current) return;
        cleanup = module.default.mount(
          ref.current,
          timelineBridge(
            seed.scope.id,
            records,
            () => setFields(true),
            () => searchRef.current(),
          ),
        );
      })
      .catch(() => {
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [records, seed.scope.id]);
  return (
    <>
      {error && (
        <p role="alert">
          Bundled timeline unavailable; retained events remain accessible, no
          CDN fallback.
        </p>
      )}
      <div className="timeline-mount" ref={ref} />
      {fields && <ContentExplorer client={client} seed={seed} />}
    </>
  );
}
