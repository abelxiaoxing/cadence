import { useState } from "react";
import { contentCursor } from "../../history/readers";
import { usePage } from "../../history/use-page";
import type { ListRequest, ReadCursor, ServiceClient } from "../../types";
import { Coverage } from "./Coverage";
import { DetailPane } from "./DetailPane";
import { PageControls } from "./PageControls";
export function ContentExplorer({
  client,
  seed,
  entityId,
}: {
  client: ServiceClient;
  seed: ListRequest;
  entityId?: string;
}) {
  const pager = usePage(client, { ...seed, reader: "contents" });
  const [selected, setSelected] = useState<ReadCursor>();
  const page = pager.page;
  return (
    <section aria-label="Retained content fields">
      <PageControls pager={pager} />
      {entityId && (
        <p>
          Showing matches for entity <code>{entityId}</code> on this page only.
          Continue paging for other fields/versions.
        </p>
      )}
      {page &&
        !("kind" in page) &&
        page.records.map((record) => {
          if (record.kind !== "content" && record.kind !== "omitted")
            return null;
          if (entityId && record.owner.entity.id !== entityId) return null;
          if (record.kind === "omitted")
            return (
              <p
                key={`${record.owner.entity.id}:${record.version}:${JSON.stringify(record.block.owner)}`}
                className="omission"
              >
                Omitted source block:{" "}
                <code>{JSON.stringify(record.block)}</code>
              </p>
            );
          return (
            <article
              key={`${record.content.recordId}:${record.content.version}`}
            >
              <p>
                {record.owner.entity.kind} <code>{record.owner.entity.id}</code>{" "}
                · {record.content.field} · {record.content.bytes} retained bytes
              </p>
              <pre>{JSON.stringify(record.descriptor.owner)}</pre>
              <Coverage value={record.coverage} />
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
                        record.content,
                      ),
                    );
                }}
              >
                Inspect complete retained field
              </button>
            </article>
          );
        })}
      {selected && (
        <DetailPane
          key={`${selected.recordId}:${selected.recordVersion}`}
          client={client}
          cursor={selected}
        />
      )}
    </section>
  );
}
