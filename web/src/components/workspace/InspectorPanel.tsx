/* Adapted from pi-web-ui RightPanel readonly tab composition. MIT (c) 2026 xing-shuyin.
 * Retained evidence only; no draft, execution or human-Review controls. */
import { useState } from "react";
import { useT } from "../../i18n/locale";
import type { ListRequest, ServiceClient } from "../../types";
import { ContentExplorer } from "../history/ContentExplorer";
import { ObservationPanel } from "../review/ObservationPanel";

const TABS = ["contents", "checks", "changes", "reviews"] as const;
export function InspectorPlaceholder() {
  const { t } = useT();
  return (
    <aside className="panel panel-right">
      <p className="panel-empty">{t("Select retained history to inspect")}</p>
    </aside>
  );
}
export function InspectorPanel({
  client,
  seed,
}: {
  client: ServiceClient;
  seed: ListRequest;
}) {
  const { t, tx } = useT();
  const [tab, setTab] = useState<(typeof TABS)[number]>("contents");
  return (
    <aside className="panel panel-right">
      <p className="inspector-note">
        {t(
          "History is readonly. Start new work in a conversation with /cadence.",
        )}
      </p>
      <nav className="rp-tabs" aria-label={t("Inspector")}>
        {TABS.map((name) => (
          <button
            type="button"
            key={name}
            className="rp-tab"
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {tx(name)}
          </button>
        ))}
      </nav>
      <div className="inspector-body">
        {tab === "contents" ? (
          <ContentExplorer client={client} seed={seed} />
        ) : (
          <ObservationPanel
            key={tab}
            client={client}
            seed={{ ...seed, reader: tab }}
          />
        )}
      </div>
    </aside>
  );
}
