/** Fixed document destinations force a fresh server-resolved actor after a context change. */
export function openOwnerPreviewWorkspace(workspaceId: string) {
  window.location.replace(`/workspaces/${encodeURIComponent(workspaceId)}/orders`);
}

export function returnToOwnerAccount() {
  window.location.replace("/owner");
}
