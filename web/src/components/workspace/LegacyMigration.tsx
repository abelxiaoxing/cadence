/* Browser conversations kept before Pi sessions became the shared history are
 * copied into them only on this explicit request; the old records stay. */
import { useState } from "react";
import type { ServiceClient } from "../../../../src/service-client.ts";
import { useWorkbench } from "../../client/use-workbench";
import { describeError, useT } from "../../i18n/locale";

export function LegacyMigration({
  client,
  onMigrated,
}: {
  client: ServiceClient;
  onMigrated(): void;
}) {
  const { t } = useT();
  const legacy = useWorkbench(client, { kind: "conversation-legacy" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const pending =
    legacy.value?.kind === "conversation-legacy" ? legacy.value.pending : 0;
  if (!pending && !result) return null;
  return (
    <div className="legacy-migration">
      {pending > 0 && (
        <>
          <p className="panel-hint">
            {t(
              "{count} earlier WebUI conversations are not in the shared history yet.",
              { count: pending },
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const reply = await client.workbenchCommand({
                kind: "conversation-migrate",
                commandId: crypto.randomUUID(),
              });
              setBusy(false);
              setResult(
                reply.kind === "error"
                  ? describeError(t, reply.error.code)
                  : reply.value.kind === "conversation-migrated"
                    ? t("Moved {migrated}; {skipped} could not be read.", {
                        migrated: reply.value.migrated,
                        skipped: reply.value.skipped,
                      })
                    : "",
              );
              legacy.refresh();
              onMigrated();
            }}
          >
            {t("Add them to the shared history")}
          </button>
        </>
      )}
      {result && <p className="panel-hint">{result}</p>}
    </div>
  );
}
