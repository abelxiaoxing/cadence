import type { CaptureCoverage } from "../../types";
export function Coverage({ value }: { value: CaptureCoverage }) {
  return (
    <p
      className={`coverage${
        value.observed === "complete" &&
        value.source === "complete" &&
        !value.redacted &&
        value.omissions.length === 0
          ? ""
          : " partial"
      }`}
    >
      Recording: {value.observed}; source: {value.source};{" "}
      {value.redacted ? "redacted" : "no reported redaction"}
      {value.omissions.length > 0 && `; omitted: ${value.omissions.join(", ")}`}
      . Not a guarantee of complete original source or universal secret
      detection.
    </p>
  );
}
