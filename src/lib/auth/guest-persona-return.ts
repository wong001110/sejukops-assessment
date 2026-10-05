import type { DemoPersona } from "./demo-entry";

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function guestPersonaReturnUrl(
  origin: string, referer: string | null, workspaceId: string, persona: DemoPersona,
): URL {
  const fallback = new URL(`/workspaces/${workspaceId}/overview`, origin);
  if (!referer) return fallback;
  let previous: URL;
  try { previous = new URL(referer); } catch { return fallback; }
  if (previous.origin !== fallback.origin) return fallback;
  const base = `/workspaces/${workspaceId}`;
  const page = previous.pathname.slice(base.length);
  if (!previous.pathname.startsWith(`${base}/`)
    || !["/overview", "/orders", "/schedule", "/agent", "/knowledge"].includes(page)) return fallback;

  const destinationPage = page === "/agent" && persona === "TECHNICIAN" || page === "/schedule" && persona !== "MANAGER" ? "/orders" : page;
  const result = new URL(`${base}${destinationPage}`, origin);
  const orderId = previous.searchParams.get("orderId");
  if (["/orders", "/schedule", "/agent"].includes(page) && orderId && ORDER_ID.test(orderId)) {
    result.searchParams.set("orderId", orderId);
  }
  return result;
}
