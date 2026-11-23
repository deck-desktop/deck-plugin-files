// The Treemap tab: the folder's folders as blocks sized by the space they take, each with its own
// largest folders inside it. A click zooms into a block, the path above comes back out.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { UsageFile, UsageNode } from "../../shim/bridge.js";
import { baseName, sizeLabel } from "../logic";
import { joinPath, nodeAt, type Report } from "./report";
import { squarify, type Rect } from "./treemap";
import { PART_COLORS } from "./Donut";

/** `file`: one of the report's large files, drawn where it lies; `node` and `file` both unset: what a
 *  folder holds beyond its listed folders and large files. */
interface Block { key: string; path: string; name: string; size: number; rect: Rect; color: string; depth: 0 | 1; node: UsageNode | null; file?: boolean }
type FilesIn = (dir: string) => UsageFile[];
/** A file block's colour: grey, so the folders' colours stay theirs. */
const FILE_COLOR = "#94a3b8";

/** At most this many blocks a level, and none smaller than this many pixels a side. */
const MAX_TOP = 40, MAX_INNER = 24, MIN_SIDE = 6, HEAD = 46;

/** A rectangle on whole pixels, its edges rounded rather than its size, so neighbours meet exactly. */
const snap = (r: Rect): Rect => { const x = Math.round(r.x), y = Math.round(r.y); return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y }; };
/** The space a block keeps around what it holds, and between it and its neighbours (GAP each side). */
const PAD = 3, GAP = 1;

/**
 * What a block has room to show, and its padding. The size comes first: the name is shown only with
 * it, and only when the whole name fits (a cut name, "cha…", says nothing). Where the size alone does
 * not fit it is tried smaller and without its space ("448MB"), with the thinnest margin. Widths are
 * estimated from the text's length (12px, 11px and 10px Inter).
 */
function labelsOf(b: Block): { name: boolean; size: string | null; tiny: boolean; px: number; py: number } {
  const w = b.rect.w - 2 * GAP - 2, h = b.rect.h - 2 * GAP - 2;
  const small = w < 90 || h < 44;
  const px = small ? 4 : 8, py = small ? 2 : 6;
  const label = sizeLabel(b.size);
  const sizeFits = label.length * 6.1 + 2 * px <= w;
  // A name that fits whole, or that keeps at least 8 letters before its "…": a block that wide still
  // says what it is (deck_flutt…), where "cha…" did not.
  const nameFits = Math.min(b.name.length, 8) * 6.8 + 2 * px <= w;
  if (sizeFits && nameFits && 30 + 2 * py <= h) return { name: true, size: label, tiny: false, px, py };
  if (sizeFits && 14 + 2 * py <= h) return { name: false, size: label, tiny: false, px, py };
  const tiny = label.replace(" ", "");
  if (tiny.length * 5.6 + 4 <= w && 13 <= h) return { name: false, size: tiny, tiny: true, px: 2, py: 0 };
  return { name: false, size: null, tiny: false, px: 0, py: 0 };
}

/** A folder's listed folders, its own large files (pagefile.sys, a video), and the rest together. */
function itemsOf(n: UsageNode, path: string, filesIn: FilesIn, max: number) {
  const kids = n.children.slice(0, max);
  const files = filesIn(path).slice(0, max);
  const rest = n.size - kids.reduce((s, c) => s + c.size, 0) - files.reduce((s, f) => s + f.size, 0);
  return [
    ...kids.map((c) => ({ node: c as UsageNode | null, file: false, path: joinPath(path, c.name), name: c.name, size: c.size })),
    ...files.map((f) => ({ node: null, file: true, path: f.path, name: baseName(f.path), size: f.size })),
    ...(rest > 0 ? [{ node: null, file: false, path: `${path}\0rest`, name: "Smaller files and folders", size: rest }] : []),
  ].sort((a, b) => b.size - a.size);
}

function layout(n: UsageNode, path: string, box: Rect, filesIn: FilesIn): Block[] {
  const items = itemsOf(n, path, filesIn, MAX_TOP);
  const rects = squarify(items.map((i) => i.size), box).map(snap);
  const out: Block[] = [];
  items.forEach((it, i) => {
    const r = rects[i];
    if (r.w < MIN_SIDE || r.h < MIN_SIDE) return;
    const p = it.path;
    const color = it.node ? PART_COLORS[i % 7] : it.file ? FILE_COLOR : PART_COLORS[7];
    out.push({ key: p, path: p, name: it.name, size: it.size, rect: r, color, depth: 0, node: it.node, file: it.file });
    // Its own largest folders and files inside it, under its name, when it has the room.
    if (it.node && it.node.children.length && r.w > 90 && r.h > HEAD + 30) {
      const inner = { x: r.x + PAD, y: r.y + HEAD, w: r.w - 2 * PAD, h: r.h - HEAD - PAD };
      const subItems = itemsOf(it.node, p, filesIn, MAX_INNER);
      squarify(subItems.map((s) => s.size), inner).map(snap).forEach((q, k) => {
        const s = subItems[k];
        // The rest is drawn too (left out, it was a hole among the blocks), faint and in the folders' grey.
        if (q.w < MIN_SIDE || q.h < MIN_SIDE) return;
        out.push({ key: s.path, path: s.path, name: s.name, size: s.size, rect: q, color: s.file ? FILE_COLOR : s.node ? color : PART_COLORS[7], depth: 1, node: s.node, file: s.file });
      });
    }
  });
  return out;
}

export function TreemapTab({ report, gone, onMenu }: { report: Report; gone: Set<string>; onMenu: (path: string, x: number, y: number) => void }) {
  const [zoom, setZoom] = useState<string[]>([]);
  const [hover, setHover] = useState<Block | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // A small label by the pointer, once it has rested on a block a moment: never in the way while you
  // move across the map, and moved with the pointer through its ref rather than a render per move.
  const tip = useRef<HTMLDivElement>(null);
  const at = useRef({ x: 0, y: 0 });
  const [rested, setRested] = useState(false);
  useEffect(() => {
    setRested(false);
    if (!hover) return;
    const t = setTimeout(() => setRested(true), 450);
    return () => clearTimeout(t);
  }, [hover]);
  const place = () => {
    const el = tip.current, b = box.current;
    if (!el || !b) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    // Below and right of the pointer, or flipped to the other side near an edge.
    const x = at.current.x + 14 + w > b.clientWidth ? at.current.x - 14 - w : at.current.x + 14;
    const y = at.current.y + 18 + h > b.clientHeight ? at.current.y - 10 - h : at.current.y + 18;
    el.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`;
  };
  useLayoutEffect(place, [rested, hover]); // eslint-disable-line react-hooks/exhaustive-deps
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    fit();
    const ro = new (el.ownerDocument.defaultView ?? window).ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const node = nodeAt(report.tree, zoom) ?? report.tree;
  const path = zoom.reduce((p, n) => joinPath(p, n), report.root);
  // The report's large files by the folder they are in, so each folder's own show as blocks.
  const byDir = useMemo(() => {
    const m = new Map<string, UsageFile[]>();
    for (const f of report.big) {
      if (gone.has(f.path)) continue;
      const d = f.path.replace(/[\\/][^\\/]*$/, "").toLowerCase();
      const list = m.get(d);
      if (list) list.push(f); else m.set(d, [f]);
    }
    return m;
  }, [report.big, gone]);
  const blocks = useMemo(() => {
    const visible = { ...node, children: node.children.filter((c) => !gone.has(joinPath(path, c.name))) };
    const filesIn: FilesIn = (dir) => byDir.get(dir.replace(/[\\/]+$/, "").toLowerCase()) ?? [];
    return size.w ? layout(visible, path, { x: 0, y: 0, w: size.w, h: size.h }, filesIn) : [];
  }, [node, path, size, gone, byDir]);
  const into = (b: Block) => { if (!b.node?.children.length) return; setHover(null); setZoom(b.path.slice(report.root.length).split(/[\\/]/).filter(Boolean)); };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 px-4 text-[12px] text-text-muted">
        {[report.tree.name, ...zoom].map((n, i, all) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span>›</span>}
            <button disabled={i === all.length - 1} onClick={() => setZoom(zoom.slice(0, i))}
              className={"rounded px-1.5 py-0.5 " + (i === all.length - 1 ? "text-text-primary" : "hover:bg-white/5 hover:text-text-primary")}>{n}</button>
          </span>
        ))}
        <span className="ml-3">{sizeLabel(node.size)} · click a block to zoom in, the path to come back out</span>
      </div>
      <div ref={box} className="relative mx-4 mb-4 min-h-0 flex-1" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); at.current = { x: e.clientX - r.left, y: e.clientY - r.top }; place(); }}>
        {blocks.map((b) => { const lab = labelsOf(b); return (
          <div key={b.key} onClick={(e) => { e.stopPropagation(); into(b); }}
            onContextMenu={(e) => { if (!b.node) return; e.preventDefault(); e.stopPropagation(); onMenu(b.path, e.clientX, e.clientY); }}
            onMouseEnter={() => setHover(b)}
            className={"absolute box-border flex flex-col overflow-hidden " + "" + (b.node?.children.length ? "cursor-zoom-in" : "")}
            style={{
              padding: lab.name || lab.size ? `${lab.py}px ${lab.px}px` : 0,
              left: b.rect.x + GAP, top: b.rect.y + GAP, width: Math.max(0, b.rect.w - 2 * GAP), height: Math.max(0, b.rect.h - 2 * GAP),
              background: `color-mix(in srgb, ${b.color} ${!b.node && !b.file ? 6 : b.depth ? 26 : b.node ? 10 : 6}%, transparent)`,
              border: `1px solid color-mix(in srgb, ${b.color} ${!b.node && !b.file ? 30 : b.depth ? 55 : 40}%, transparent)`,
              outline: hover?.key === b.key ? "1px solid var(--text-primary)" : undefined,
            }}>
            {lab.name && <span className={"truncate text-[12px] leading-4 " + (b.depth ? "text-text-primary" : "font-semibold text-text-primary")}>{b.name}</span>}
            {lab.size && <span className={"whitespace-nowrap text-text-secondary " + (lab.tiny ? "text-[10px] leading-[13px]" : "text-[11px] leading-[14px]")}>{lab.size}</span>}
          </div>
        ); })}
        {hover && rested && (
          <div ref={tip} className="pointer-events-none absolute left-0 top-0 z-10 flex max-w-[420px] flex-col gap-0.5 whitespace-nowrap rounded-md border border-subtle bg-elev/95 px-2 py-1 text-[11.5px] shadow-lg">
            <span className="truncate font-mono text-[11px] text-text-muted">{hover.node || hover.file ? hover.path : path}</span>
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 truncate text-text-primary">{hover.name}</span>
              <span className="font-semibold text-text-primary">{sizeLabel(hover.size)}</span>
              <span className="text-text-muted">{((hover.size / (node.size || 1)) * 100).toFixed(1)}%{hover.node ? ` · ${hover.node.files.toLocaleString()} files` : ""}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
