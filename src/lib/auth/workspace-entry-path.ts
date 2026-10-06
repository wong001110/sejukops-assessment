import type { AppRole } from "./types";
/** Role landing keeps the former operational portal entry points. */
export function workspaceEntryPage(role: AppRole | undefined): "overview" | "orders" {
  return role === "MANAGER" ? "overview" : "orders";
}
