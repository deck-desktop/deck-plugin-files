// An element's width as it changes, for laying Files out to the pane it is in: a narrow pane drops
// the sidebar, the button labels and the list's quieter columns rather than squeezing the names.
import { useEffect, useState, type RefObject } from "react";

/** The width of `ref`'s element in px; Infinity until it is measured, so nothing hides on mount. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(Infinity);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const win = el.ownerDocument.defaultView ?? window;
    const ro = new win.ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
