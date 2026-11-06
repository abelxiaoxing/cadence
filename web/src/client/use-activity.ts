import { useEffect, useState } from "react";
import type { ActivityDiscovery } from "../../../src/service/contracts/activity.ts";
import { observeActivity } from "./activity";

export function useActivity(
  epoch: string | undefined,
  changedEpoch: () => void,
) {
  const [value, setValue] = useState<ActivityDiscovery>();
  const [error, setError] = useState("");
  useEffect(() => {
    setValue(undefined);
    setError("");
    if (!epoch) return;
    return observeActivity(
      epoch,
      (value, error) => {
        setValue(value);
        setError(error);
      },
      changedEpoch,
    );
  }, [epoch, changedEpoch]);
  return { value, error };
}
