// Synthetic MSW renderer only: keep in-memory fixtures across simulated navigation.
// Fresh document navigation is verified separately with the real product helper.
import { navigatePreview } from "./next-navigation";

export function openOwnerPreviewWorkspace(workspaceId: string) {
  navigatePreview(`/workspaces/${encodeURIComponent(workspaceId)}/orders`);
}

export function returnToOwnerAccount() {
  navigatePreview("/owner");
}
