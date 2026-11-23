// The Treemap tab: the folder's folders as blocks sized by the space they take, each with its own
// largest folders inside it. A click zooms into a block, the path above comes back out.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { UsageNode } from "../../shim/bridge.js";
import { sizeLabel } from "../logic";
import { joinPath, nodeAt, restOf, type Report } from "./report";
import { squarify, type Rect } from "./treemap";
import { PART_COLORS } from "./Donut";

interface Block { key: string; path: string; name: string; size: number; rect: Rect; color: string; depth: 0 | 1; node: UsageNode | null }

/** At most this many blocks a level, and none smaller than this many pixels a side. */
const MAX_TOP = 40, MAX_INNER = 24, MIN_SIDE = 6, HEAD = 46;

/** A rectangle on whole pixels, its edges rounded rather than its size, so neighbours meet exactly. */
const snap = (r: Rect): Rect => { const x = Math.round(r.x), y = Math.round(r.y); return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y }; };
/** The space a block keeps around what it holds, and between it and its neighbours (GAP each side). */
const PAD = 3, GAP = 1;

function layout(n: UsageNode, path: string, box: Rect): Block[] {
  const kids = n.children.slice(0, MAX_TOP);
  const rest = n.size - kids.reduce((s, c) => s + c.size, 0);
  const items = [...kids.map((c) => ({ node: c as UsageNode | null, name: c.name, size: c.size })), ...(rest > 0 ? [{ node: null, name: "Files and smaller folders", size: rest }] : [])];
  const rects = squarify(items.map((i) => i.size), box).map(snap);
  const out: Block[] = [];
  items.forEach((it, i) => {
    const r = rects[i];
    if (r.w < MIN_SIDE || r.h < MIN_SIDE) return;
    const p = it.node ? joinPath(path, it.name) : `${path}\0rest`;
    const color = it.node ? PART_COLORS[i % 7] : PART_COLORS[7];
    out.push({ key: p, path: p, name: it.name, size: it.size, rect: r, color, depth: 0, node: it.node });
    // Its own largest folders inside it, under its name, when it has the room.
    if (it.node && it.node.children.length && r.w > 90 && r.h > HEAD + 30) {
      const inner = { x: r.x + PAD, y: r.y + HEAD, w: r.w - 2 * PAD, h: r.h - HEAD - PAD };
      const sub = it.node.children.slice(0, MAX_INNER);
      const subRest = restOf({ ...it.node, children: sub });
      const subItems = [...sub.map((c) => ({ c: c as UsageNode | null, size: c.size })), ...(subRest > 0 ? [{ c: null, size: subRest }] : [])];
      squarify(subItems.map((s) => s.size), inner).map(snap).forEach((q, k) => {
        const s = subItems[k];
        if (!s.c || q.w < MIN_SIDE || q.h < MIN_SIDE) return;
        const sp = joinPath(p, s.c.name);
        out.push({ key: sp, path: sp, name: s.c.name, size: s.c.size, rect: q, color, depth: 1, node: s.c });
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
  const blocks = useMemo(() => {
    const visible = { ...node, children: node.children.filter((c) => !gone.has(joinPath(path, c.name))) };
    return size.w ? layout(visible, path, { x: 0, y: 0, w: size.w, h: size.h }) : [];
  }, [node, path, size, gone]);
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
        {blocks.map((b) => (
          <div key={b.key} onClick={(e) => { e.stopPropagation(); into(b); }}
            onContextMenu={(e) => { if (!b.node) return; e.preventDefault(); e.stopPropagation(); onMenu(b.path, e.clientX, e.clientY); }}
            onMouseEnter={() => setHover(b)}
            className={"absolute box-border flex flex-col overflow-hidden " + (b.rect.w > 46 && b.rect.h > 22 ? "px-2 py-1.5 " : "") + (b.node?.children.length ? "cursor-zoom-in" : "")}
            style={{
              left: b.rect.x + GAP, top: b.rect.y + GAP, width: Math.max(0, b.rect.w - 2 * GAP), height: Math.max(0, b.rect.h - 2 * GAP),
              background: `color-mix(in srgb, ${b.color} ${b.depth ? 26 : b.node ? 10 : 6}%, transparent)`,
              border: `1px solid color-mix(in srgb, ${b.color} ${b.depth ? 55 : 40}%, transparent)`,
              outline: hover?.key === b.key ? "1px solid var(--text-primary)" : undefined,
            }}>
            {b.rect.w > 46 && b.rect.h > 22 && <span className={"truncate text-[12px] leading-4 " + (b.depth ? "text-text-primary" : "font-semibold text-text-primary")}>{b.name}</span>}
            {b.rect.w > 46 && b.rect.h > 38 && <span className="truncate text-[11px] leading-[14px] text-text-secondary">{sizeLabel(b.size)}</span>}
          </div>
        ))}
        {hover && rested && (
          <div ref={tip} className="pointer-events-none absolute left-0 top-0 z-10 flex max-w-[420px] flex-col gap-0.5 whitespace-nowrap rounded-md border border-subtle bg-elev/95 px-2 py-1 text-[11.5px] shadow-lg">
            <span className="truncate font-mono text-[11px] text-text-muted">{hover.node ? hover.path : path}</span>
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 truncate text-text-primary">{hover.node ? hover.name : "Files and smaller folders"}</span>
              <span className="font-semibold text-text-primary">{sizeLabel(hover.size)}</span>
              <span className="text-text-muted">{((hover.size / (node.size || 1)) * 100).toFixed(1)}%{hover.node ? ` · ${hover.node.files.toLocaleString()} files` : ""}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
