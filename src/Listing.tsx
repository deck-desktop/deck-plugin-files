// The folder's entries, as a table (Details) or as tiles (Grid). Selection, renaming and the
// keyboard live in Files.tsx; this draws them and reports what was clicked.
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { FileIcon, themeById, useEditorSettings } from "../shim/ui.js";
import { convertFileSrc } from "../shim/bridge.js";
import { isRemote, previewKind, sizeLabel, typeLabel, type Entry, type Group, type SortKey } from "./logic";
import { when } from "./Preview";
import { useThumb } from "./thumbs";
import { DROP, pressItem } from "./drag";

export interface ListProps {
  /** The folder shown: dropping files on the listing's empty space moves them here. */
  cwd: string;
  entries: Entry[];
  /** The entries in groups (Sort, Group by), each under a heading; null when not grouped. */
  groups: Group[] | null;
  selected: Set<string>;
  focus: string | null;
  cut: Set<string>;
  renaming: string | null;
  sort: SortKey; asc: boolean;
  onSort: (k: SortKey) => void;
  onPick: (e: Entry, ev: React.MouseEvent) => void;
  onOpen: (e: Entry) => void;
  onMenu: (e: Entry | null, ev: React.MouseEvent) => void;
  onRename: (e: Entry, name: string | null) => void;
  /** A box dragged over the listing: what it covers (with what was selected, Ctrl or Shift held). */
  onMarquee: (paths: Set<string>) => void;
  /** What dragging `e` carries: the selection when `e` is in it, else `e`. */
  dragItems: (e: Entry) => Entry[];
  /** A press on `e` let go without dragging: a plain click, which leaves only `e` selected. */
  onSettle: (e: Entry, ev: MouseEvent) => void;
}

/** A press on an entry: picked at once (Files.tsx), and dragged from there if the pointer moves. */
const press = (p: ListProps, e: Entry, ev: React.MouseEvent, draggable = true) => {
  p.onPick(e, ev);
  if (draggable && ev.button === 0 && p.renaming !== e.path) {
    const at = ev.nativeEvent;
    pressItem(ev, () => p.dragItems(e), () => p.onSettle(e, at));
  }
};
/** A group's heading: its name, how many are in it, and a rule to the edge, as Explorer draws it. */
function GroupHead({ g, first }: { g: Group; first: boolean }) {
  return (
    <div className={"flex items-center gap-2 px-2.5 pb-1 text-[12px] font-medium text-text-secondary " + (first ? "pt-1" : "pt-4")} style={{ gridColumn: "1 / -1" }}>
      <span>{g.label}</span>
      <span className="text-text-muted">{g.entries.length}</span>
      <span className="h-px flex-1 bg-[var(--border-subtle,#30363d)]" />
    </div>
  );
}
/** The entries, or each group's heading followed by its entries. */
const inGroups = (p: ListProps, draw: (e: Entry) => React.ReactNode) =>
  p.groups ? p.groups.map((g, i) => [<GroupHead key={`g:${g.label}`} g={g} first={i === 0} />, ...g.entries.map(draw)]) : p.entries.map(draw);

/** A folder entry is somewhere to drop files. */
const dropDir = (e: Entry) => (e.dir ? { [DROP]: e.path } : {});

/**
 * Drag on the listing's empty space to select what a box covers, as Explorer does. The box is in
 * the scrolled content's coordinates, so it stays put on the files while the list scrolls under a
 * pointer held past its top or bottom edge. Starts after a few pixels, so a plain click on empty
 * space still only clears the selection (Files.tsx). In Details (`fromRows`) a row is the whole
 * width, so, as in Explorer, a box also starts on a row anywhere but its name: the press selects
 * the row as usual, and dragging on from there turns it into a box.
 */
function useMarquee(p: ListProps, fromRows = false) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const onMouseDown = (ev: React.MouseEvent) => {
    const el = ref.current;
    const t = ev.target as HTMLElement;
    if (!el || ev.button !== 0 || (t.closest("[data-path]") && (!fromRows || t.closest("[data-name]")))) return;
    // Not on the scrollbar: past the content's width is the bar.
    const r0 = el.getBoundingClientRect();
    if (ev.clientX - r0.left >= el.clientWidth) return;
    const at = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: cx - r.left + el.scrollLeft, y: cy - r.top + el.scrollTop };
    };
    const start = at(ev.clientX, ev.clientY);
    const base = ev.ctrlKey || ev.shiftKey ? new Set(latest.current.selected) : new Set<string>();
    let pointer = { x: ev.clientX, y: ev.clientY }, live = false, raf = 0;
    const win = el.ownerDocument.defaultView ?? window;
    const update = () => {
      const r = el.getBoundingClientRect();
      // Held past the top or bottom: scroll toward it, faster the further out.
      const over = pointer.y < r.top ? pointer.y - r.top : pointer.y > r.bottom ? pointer.y - r.bottom : 0;
      if (over) el.scrollTop += Math.max(-40, Math.min(40, over / 2));
      const now = at(pointer.x, pointer.y);
      const b = { x: Math.min(start.x, now.x), y: Math.min(start.y, now.y), w: Math.abs(now.x - start.x), h: Math.abs(now.y - start.y) };
      if (!live && b.w < 4 && b.h < 4) return;
      live = true;
      setBox(b);
      const hit = new Set(base);
      for (const node of el.querySelectorAll<HTMLElement>("[data-path]")) {
        const nr = node.getBoundingClientRect();
        const n = { x: nr.left - r.left + el.scrollLeft, y: nr.top - r.top + el.scrollTop };
        if (n.x < b.x + b.w && n.x + nr.width > b.x && n.y < b.y + b.h && n.y + nr.height > b.y) hit.add(node.dataset.path!);
      }
      latest.current.onMarquee(hit);
    };
    const tick = () => { update(); raf = win.requestAnimationFrame(tick); };
    const move = (e: MouseEvent) => { pointer = { x: e.clientX, y: e.clientY }; };
    const up = (e: MouseEvent) => {
      win.cancelAnimationFrame(raf);
      // Where it was let go counts, even when no frame ran since the last move.
      pointer = { x: e.clientX, y: e.clientY };
      update();
      win.removeEventListener("mousemove", move);
      win.removeEventListener("mouseup", up);
      setBox(null);
    };
    win.addEventListener("mousemove", move);
    win.addEventListener("mouseup", up);
    raf = win.requestAnimationFrame(tick);
  };
  const overlay = box && (
    <div aria-hidden className="pointer-events-none absolute z-10 rounded-sm border"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 14%, transparent)" }} />
  );
  return { ref, onMouseDown, overlay };
}

function RenameBox({ e, onRename }: { e: Entry; onRename: (e: Entry, name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const i = ref.current;
    if (!i) return;
    i.focus();
    // The name without its extension, as Explorer selects it.
    const dot = e.dir ? -1 : e.name.lastIndexOf(".");
    i.setSelectionRange(0, dot > 0 ? dot : e.name.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (name: string | null) => onRename(e, name === null || name.trim() === "" || name === e.name ? null : name.trim());
  return (
    <input ref={ref} defaultValue={e.name} aria-label={`Rename ${e.name}`}
      onClick={(ev) => ev.stopPropagation()} onDoubleClick={(ev) => ev.stopPropagation()}
      onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === "Enter") done(ev.currentTarget.value); if (ev.key === "Escape") done(null); }}
      onBlur={(ev) => done(ev.currentTarget.value)}
      className="min-w-0 flex-1 rounded border border-[var(--accent)] bg-elev px-1 text-[12.5px] text-text-primary outline-none" />
  );
}

const COLS = "grid grid-cols-[minmax(0,1fr)_150px_130px_90px]";

export function Details(p: ListProps) {
  const theme = themeById(useEditorSettings().iconTheme);
  const marquee = useMarquee(p, true);
  const head = (k: SortKey, label: string, right = false) => (
    <button onClick={() => p.onSort(k)} className={"flex items-center gap-1 hover:text-text-primary " + (right ? "justify-end" : "") + (p.sort === k ? " text-text-secondary" : "")}>
      {label}{p.sort === k && (p.asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col" onContextMenu={(ev) => { if (ev.target === ev.currentTarget) p.onMenu(null, ev); }}>
      <div className={COLS + " h-8 shrink-0 items-center border-b border-subtle px-4 text-[11.5px] text-text-muted"}>
        {head("name", "Name")}{head("date", "Date modified")}{head("type", "Type")}{head("size", "Size", true)}
      </div>
      <div role="grid" aria-label="Files" ref={marquee.ref} onMouseDown={marquee.onMouseDown} {...{ [DROP]: p.cwd }}
        className="scroll-thin relative min-h-0 flex-1 overflow-y-auto px-1.5 py-1"
        onContextMenu={(ev) => { if (ev.target === ev.currentTarget) { ev.preventDefault(); p.onMenu(null, ev); } }}>
        {inGroups(p, (e) => {
          const on = p.selected.has(e.path);
          return (
            <div key={e.path} role="row" aria-selected={on} data-path={e.path} {...dropDir(e)}
              onMouseDown={(ev) => press(p, e, ev, !!(ev.target as HTMLElement).closest("[data-name]"))} onDoubleClick={() => p.onOpen(e)}
              onContextMenu={(ev) => { ev.preventDefault(); p.onMenu(e, ev); }}
              className={COLS + " h-[30px] cursor-default select-none items-center rounded-md px-2.5 text-[12.5px] "
                + (on ? "bg-[var(--accent-soft)] text-text-primary" : "text-text-secondary hover:bg-white/5")
                + (p.focus === e.path ? " outline outline-1 outline-[var(--accent)]" : "")
                + (p.cut.has(e.path) || e.hidden ? " opacity-55" : "")}>
              <span className="flex min-w-0 items-center gap-2">
                <FileIcon icon={e.dir ? theme.folder(e.name, false) : theme.file(e.name)} size={15} />
                {p.renaming === e.path ? <RenameBox e={e} onRename={p.onRename} /> : <span data-name className="truncate">{e.name}</span>}
              </span>
              <span className="truncate text-text-muted">{when(e.mtimeMs)}</span>
              <span className="truncate text-text-muted">{typeLabel(e)}</span>
              <span className="text-right text-text-muted">{e.dir ? "" : sizeLabel(e.size)}</span>
            </div>
          );
        })}
        {marquee.overlay}
      </div>
    </div>
  );
}

const TILE = [0, 96, 132, 180, 240];

function Tile({ e, size, on, focus, dim, renaming, p }: { e: Entry; size: number; on: boolean; focus: boolean; dim: boolean; renaming: boolean; p: ListProps }) {
  const theme = themeById(useEditorSettings().iconTheme);
  const kind = previewKind(e.name);
  // An SVG is drawn as itself: Windows' thumbnail for one is only the file type's icon.
  const svg = !e.dir && !isRemote(e.path) && /\.svg$/i.test(e.name);
  const thumbable = !svg && !e.dir && !isRemote(e.path) && (kind === "image" || kind === "photo" || kind === "media" || kind === "pdf");
  const thumb = useThumb(e.path, e.mtimeMs, Math.round(TILE[size] * 1.5), thumbable);
  const url = svg ? `${convertFileSrc(e.path)}?v=${e.mtimeMs}` : thumb;
  return (
    <div role="gridcell" aria-selected={on} data-path={e.path} {...dropDir(e)}
      onMouseDown={(ev) => press(p, e, ev)} onDoubleClick={() => p.onOpen(e)}
      onContextMenu={(ev) => { ev.preventDefault(); p.onMenu(e, ev); }}
      className={"flex cursor-default select-none flex-col gap-1.5 rounded-lg p-1.5 "
        + (on ? "bg-[var(--accent-soft)]" : "hover:bg-white/5") + (focus ? " outline outline-1 outline-[var(--accent)]" : "") + (dim ? " opacity-55" : "")}>
      <div className="grid place-items-center overflow-hidden rounded-md bg-elev"
        style={{ height: Math.round(TILE[size] * 0.75), ...(svg && url ? { background: "repeating-conic-gradient(#e8e8e8 0 25%, #f8f8f8 0 50%) 0 0 / 16px 16px" } : {}) }}>
        {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" />
          : <FileIcon icon={e.dir ? theme.folder(e.name, false) : theme.file(e.name)} size={Math.round(TILE[size] / 3)} />}
      </div>
      {renaming ? <RenameBox e={e} onRename={p.onRename} />
        : <span className={"line-clamp-2 break-all text-center text-[12px] " + (on ? "text-text-primary" : "text-text-secondary")}>{e.name}</span>}
    </div>
  );
}

export function Grid(p: ListProps & { size: number }) {
  const marquee = useMarquee(p);
  return (
    <div role="grid" aria-label="Files" ref={marquee.ref} onMouseDown={marquee.onMouseDown} {...{ [DROP]: p.cwd }}
      className="scroll-thin relative min-h-0 flex-1 overflow-y-auto p-3"
      onContextMenu={(ev) => { if (ev.target === ev.currentTarget) { ev.preventDefault(); p.onMenu(null, ev); } }}>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE[p.size]}px, 1fr))` }}
        onContextMenu={(ev) => { if (ev.target === ev.currentTarget) { ev.preventDefault(); p.onMenu(null, ev); } }}>
        {inGroups(p, (e) => (
          <Tile key={e.path} e={e} size={p.size} on={p.selected.has(e.path)} focus={p.focus === e.path}
            dim={p.cut.has(e.path) || e.hidden} renaming={p.renaming === e.path} p={p} />
        ))}
      </div>
      {marquee.overlay}
    </div>
  );
}
