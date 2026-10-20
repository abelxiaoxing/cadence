import { useEffect, useRef, useState } from "react";
import { canonicalJson } from "../../../src/service-contract.ts";
import type { HistoryReadResult, ListRequest, ServiceClient } from "../types";
import { readPage } from "./readers";
export function usePage(client: ServiceClient, seed: ListRequest | null) {
  // Once a read begins, new live watermarks never rebase its continuation.
  // Scope changes reset; the explicit refresh control starts a new selected read.
  const identity = seed
    ? canonicalJson({
        reader: seed.reader,
        storeId: seed.storeId,
        scope: seed.scope,
        limit: seed.limit,
      })
    : "absent";
  const [page, setPage] = useState<HistoryReadResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [request, setRequest] = useState<ListRequest | null>(seed);
  const [back, setBack] = useState<ListRequest[]>([]);
  const generation = useRef(0);
  const [selectedIdentity, setSelectedIdentity] = useState(identity);
  if (selectedIdentity !== identity) {
    generation.current++;
    setSelectedIdentity(identity);
    setPage(undefined);
    setError(undefined);
    setRequest(seed);
    setBack([]);
  }
  useEffect(() => {
    const ticket = ++generation.current;
    if (!request) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setError(undefined);
    void readPage(client, request, controller.signal)
      .then((reply) => {
        if (ticket !== generation.current) return;
        setBusy(false);
        if (reply.kind === "error") setError(reply.error.code);
        else setPage(reply.value);
      })
      .catch(() => {
        if (ticket === generation.current) {
          setError("Read unavailable.");
          setBusy(false);
        }
      });
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [client, request]);
  return {
    page,
    busy,
    error,
    more: () => {
      if (!busy && page?.next) {
        if (request) setBack((p) => [...p, request]);
        setRequest(page.next);
      }
    },
    previous: () => {
      if (!busy && back.length) {
        setRequest(back[back.length - 1]);
        setBack((p) => p.slice(0, -1));
      }
    },
    canPrevious: back.length > 0,
    refresh: () => {
      setPage(undefined);
      setBack([]);
      setRequest(seed ? { ...seed } : null);
    },
  };
}
