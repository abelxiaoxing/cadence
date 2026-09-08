/** Only scenarios with a positive oracle are release gates. */
export function matrixScenarios(scenarios, includeObservations = false) {
  return scenarios.filter(
    (scenario) => includeObservations || scenario.expected !== "blocked",
  );
}
export function matrixPassed(results, live) {
  return results
    .filter((entry) => entry.expected !== "blocked")
    .every(
      (entry) =>
        entry.exitCode === 0 &&
        (live
          ? entry.report.success === true
          : entry.report.reason === "preflight-only"),
    );
}
