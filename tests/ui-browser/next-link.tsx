import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigatePreview } from "./next-navigation";

export default function PreviewLink({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  function click(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigatePreview(href);
  }
  return <a {...props} href={href} onClick={click} />;
}
