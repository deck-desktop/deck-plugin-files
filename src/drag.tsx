// Dragging files to move or copy them: onto a folder in the listing, in the path bar or the
// sidebar, onto another folder's listing, or onto one of Files' own tabs. Held over a tab for a
// moment, the tab opens, so the files can go into one of its folders.
//
// Pointer events, not HTML5 drag and drop: Deck's window takes files dropped from Windows, which
// turns HTML5's off (Deck's components/TabStrip.tsx says the same).
//
// As in Explorer: onto the same drive it is a move, onto another drive (or between a server's
// folders and this PC's, which is refused) a copy; Ctrl makes it a copy, Shift a move.
import { useSyncExternalStore } from "react";
import { transfer, type Ask } from "./ops";
import { getState, update } from "./store";
import { baseName, canDrop, sameVolume } from "./logic";
import { notice } from "./notice";

/** A drop target names its folder in this attribute. */
export const DROP = "data-drop-dir";
/** On the element holding Files' tab strip, whose tabs Deck's TabStrip marks with data-drag-id. */
export const TABS = "data-files-tabs";

/** The explorer on screen, which asks about clashes and reports how it went. */
export interface DropHost { ask: Ask; fail: (what: string, e: unknown) => void }
let host: DropHost | null = null;
export const setDropHost = (h: DropHost | null) => { host = h; };

export interface Dragging { x: number; y: number; count: number; copy: boolean; into: string | null }
let dragging: Dragging | null = null;
const subs = new Set<() => void>();
const set = (d: Dragging | null) => { dragging = d; subs.forEach((f) => f()); };
export const useDragging = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => dragging);

/**
 * Called on a press on a file. Past a few pixels it is a drag of `items()` (the selection when the
 * file is in it, else the file); let go without moving, `onClick` runs instead.
 */
export function pressItem(ev: React.MouseEvent, items: () => { path: string; dir: boolean }[], onClick: () => void) {
  if (ev.button !== 0) return;
  const win = (ev.currentTarget as HTMLElement).ownerDocument.defaultView ?? window;
  const doc = win.document;
  const start = { x: ev.clientX, y: ev.clientY };
  let list: { path: string; dir: boolean }[] | null = null;
  let over: HTMLElement | null = null, into: string | null = null;
  let tabTimer = 0, tabUnder = "";
  const mark = (el: HTMLElement | null) => {
    if (over === el) return;
    if (over) over.style.outline = "";
    over = el;
    if (el) { el.style.outline = "1px solid var(--accent)"; el.style.outlineOffset = "-1px"; }
  };
  const copyFor = (e: MouseEvent) => (e.ctrlKey ? true : e.shiftKey ? false : !!into && !!list && !sameVolume(list[0].path, into));
  const target = (e: MouseEvent) => {
    const x = e.clientX, y = e.clientY;
    const el = doc.elementFromPoint(x, y) as HTMLElement | null;
    // One of Files' tabs: its folder, and held there, the tab opens.
    const tab = el?.closest(`[${TABS}] [data-drag-id]`) as HTMLElement | null;
    const tabId = tab?.getAttribute("data-drag-id") ?? "";
    if (tabId !== tabUnder) {
      win.clearTimeout(tabTimer);
      tabUnder = tabId;
      if (tabId && tabId !== getState().active) tabTimer = win.setTimeout(() => update({ active: tabId }), 600);
    }
    const tabDir = tabId ? getState().tabs.find((t) => t.id === tabId)?.path : undefined;
    const dropEl = tab ?? (el?.closest(`[${DROP}]`) as HTMLElement | null);
    const dir = tabDir ?? dropEl?.getAttribute(DROP) ?? null;
    const ok = !!dir && !!list && canDrop(list, dir);
    mark(ok ? dropEl : null);
    into = ok ? dir : null;
    set({ x, y, count: list!.length, copy: copyFor(e), into: into && baseName(into) });
  };
  const move = (e: MouseEvent) => {
    if (!list && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
    list ??= items();
    target(e);
  };
  const end = () => {
    win.clearTimeout(tabTimer);
    mark(null);
    win.removeEventListener("mousemove", move);
    win.removeEventListener("mouseup", up);
    win.removeEventListener("keydown", key, true);
    set(null);
  };
  const up = (e: MouseEvent) => {
    const was = list, dest = into, copy = copyFor(e);
    end();
    if (!was) { onClick(); return; }
    if (!dest || !host) return;
    const h = host;
    void transfer(was, dest, !copy, h.ask).then(
      (n) => { if (n) notice(`${n} item${n === 1 ? "" : "s"} ${copy ? "copied" : "moved"} to ${baseName(dest)}`); },
      (err) => h.fail(copy ? "Copying failed" : "Moving failed", err));
  };
  // Escape drops nothing.
  const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(); } };
  win.addEventListener("mousemove", move);
  win.addEventListener("mouseup", up);
  win.addEventListener("keydown", key, true);
}

/** What is being dragged, beside the pointer: how many, and where to. */
export function DragBadge() {
  const d = useDragging();
  if (!d) return null;
  const what = d.count === 1 ? "1 item" : `${d.count} items`;
  return (
    <div className="pointer-events-none fixed z-[200] rounded-md border border-subtle bg-card px-2 py-1 text-[12px] text-text-primary shadow-xl"
      style={{ left: d.x + 14, top: d.y + 14 }}>
      {d.into ? `${d.copy ? "Copy" : "Move"} ${what} to ${d.into}` : what}
    </div>
  );
}
