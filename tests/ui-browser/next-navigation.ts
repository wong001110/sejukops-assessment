import { ids } from "../fixtures/ui/workspace";

export function navigatePreview(href: string) {
  const destination = new URL(href, window.location.origin);
  if (destination.origin !== window.location.origin) throw new Error("External navigation is unavailable in the MOCK preview.");
  window.history.pushState(null, "", destination.pathname + destination.search + destination.hash);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
export function useRouter() {
  return { push: navigatePreview, replace: (href: string) => {
    window.history.replaceState(null, "", href); window.dispatchEvent(new PopStateEvent("popstate"));
  }, refresh: () => { window.dispatchEvent(new Event("mock-router-refresh")); }, back: () => window.history.back() };
}
export function useParams<T>() { return { workspaceId: ids.workspace } as T; }
