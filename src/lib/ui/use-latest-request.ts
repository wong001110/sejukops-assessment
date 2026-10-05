"use client";

import { useEffect, useMemo, useRef } from "react";

/** Only the latest request may change a mounted screen's state. */
export function useLatestRequest() {
  const current = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const requests = useMemo(() => ({
    pending: () => current.current !== null,
    cancel() {
      revision.current += 1;
      current.current?.abort();
      current.current = null;
    },
    begin() {
      current.current?.abort();
      const controller = new AbortController();
      const version = ++revision.current;
      current.current = controller;
      return {
        signal: controller.signal,
        isCurrent: () => revision.current === version && !controller.signal.aborted,
        finish: () => { if (current.current === controller) current.current = null; },
      };
    },
  }), []);
  useEffect(() => () => requests.cancel(), [requests]);
  return requests;
}
