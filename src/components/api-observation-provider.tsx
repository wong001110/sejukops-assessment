"use client";

import { useLayoutEffect } from "react";

import { installApiObservation } from "@/lib/observability/api-observation";

/**
 * Installs the browser-session API observer before child passive effects issue their
 * initial data requests. Observation is deliberately fail-open and never becomes a
 * dependency of the operational workflow.
 */
export function ApiObservationProvider({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => installApiObservation(), []);
  return children;
}
