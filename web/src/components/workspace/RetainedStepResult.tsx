import type { WorkbenchResult } from "../../../../src/service/contracts/workbench.ts";
import { useT } from "../../i18n/locale";
import { CopyButton } from "../rich/CopyButton";

/** The displayed file, not the step summary. Reading/polling belongs to the view. */
export function RetainedStepResult({
  file,
}: {
  file: Extract<WorkbenchResult, { kind: "file" }>;
}) {
  const { t } = useT();
  return (
    <div className="retained-result toolcall-output">
      <div className="toolcall-output-label">
        {t("Step result")}
        <CopyButton
          text={file.text}
          label={t("Copy output")}
          className="output-copy"
        />
      </div>
      <pre className="workflow-detail">{file.text}</pre>
      {file.limited && <p>{t("Preview is truncated.")}</p>}
    </div>
  );
}
