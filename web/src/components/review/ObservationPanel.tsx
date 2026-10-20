/* Adapted from pi-web-ui SCMPanel readonly list/diff and RightPanel detail tabs.
 * MIT (c) 2026 xing-shuyin. No filesystem/Git mutation API. */
import { useState } from "react";
import { contentCursor } from "../../history/readers";
import { usePage } from "../../history/use-page";
import type { ListRequest, ReadCursor, ServiceClient } from "../../types";
import { DetailPane } from "../history/DetailPane";
import { PageControls } from "../history/PageControls";
import { ArtifactPreview } from "./ArtifactPreview";
export function ObservationPanel({
  client,
  seed,
}: {
  client: ServiceClient;
  seed: ListRequest;
}) {
  const pager = usePage(client, seed),
    [selected, setSelected] = useState<ReadCursor>();
  const page = pager.page;
  return (
    <section className="scm-body">
      <PageControls pager={pager} />
      <p>
        Captured observations include pre-existing dirt. They do not attribute
        every change to Cadence; bounded fingerprints are not filesystem
        snapshots.
      </p>
      <div className="scm-files-list">
        {page &&
          !("kind" in page) &&
          page.records.map((r) => {
            if (r.kind !== "owner-fact") return null;
            const fact = r.fact;
            const content =
              fact.kind === "changes" || fact.kind === "review"
                ? fact.content
                : fact.kind === "check-settled"
                  ? fact.output
                  : null;
            return (
              <article className="scm-file" key={r.recordId}>
                <h3>
                  {fact.kind} · committed #{r.committedSeq}
                </h3>
                <pre>{JSON.stringify(fact, null, 2)}</pre>
                {content && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        page.request.scope.kind !== "workspace" &&
                        page.request.snapshotSeq !== null
                      )
                        setSelected(
                          contentCursor(
                            page.request.storeId,
                            page.request.scope,
                            page.request.snapshotSeq,
                            content,
                          ),
                        );
                    }}
                  >
                    Inspect full retained {content.field}
                  </button>
                )}
              </article>
            );
          })}
      </div>
      {selected && (
        <DetailPane
          key={`${selected.recordId}:${selected.recordVersion}`}
          client={client}
          cursor={selected}
          render={(text) => <ArtifactPreview text={text} />}
        />
      )}
    </section>
  );
}
