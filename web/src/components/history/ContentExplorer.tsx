import { useState } from "react";
import { contentCursor } from "../../history/readers";
import { usePage } from "../../history/use-page";
import { Template, useT } from "../../i18n/locale";
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
  const { t, tx } = useT();
  const pager = usePage(client, { ...seed, reader: "contents" });
  const [selected, setSelected] = useState<ReadCursor>();
  const page = pager.page;
  return (
    <section aria-label={t("Retained content fields")}>
      <PageControls pager={pager} />
      {entityId && (
        <p>
          <Template
            text={t(
              "Showing matches for entity {entity} on this page only. Continue paging for other fields/versions.",
            )}
            slots={{ entity: <code>{entityId}</code> }}
          />
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
                {t("Omitted source block:")}{" "}
                <code>{JSON.stringify(record.block)}</code>
              </p>
            );
          return (
            <article
              key={`${record.content.recordId}:${record.content.version}`}
            >
              <p>
                {tx(record.owner.entity.kind)}{" "}
                <code>{record.owner.entity.id}</code> ·{" "}
                {tx(record.content.field)} ·{" "}
                {t("{bytes} retained bytes", { bytes: record.content.bytes })}
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
                {t("Inspect complete retained field")}
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
