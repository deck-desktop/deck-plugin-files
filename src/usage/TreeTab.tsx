// The Tree tab: the folders, largest first, each with its share of the folder it is in; beside it the
// selected folder: its numbers, a ring of what it holds, and what can be done with it.
import { useMemo, useState } from "react";
import { ChevronRight, Files as FilesIcon } from "lucide-react";
import { FileIcon, themeById, useEditorSettings } from "../../shim/ui.js";
import type { UsageNode } from "../../shim/bridge.js";
import { fsReveal } from "../../shim/bridge.js";
import { sizeLabel } from "../logic";
import { agoLabel, joinPath, restOf, type Report } from "./report";
import { Donut, PART_COLORS, type Part } from "./Donut";

interface Row { node: UsageNode | null; path: string; depth: number; size: number; share: number; parent: string }

const grid = "grid grid-cols-[minmax(0,1fr)_88px_190px_84px_110px] items-center gap-3";

export function TreeTab({ report, free, gone, onOpen, onTrash, onMenu }: {
  report: Report;
  /** The drive's free space, when the report is of a drive's root. */
  free: number | null;
  gone: Set<string>;
  onOpen: (path: string) => void;
  onTrash: (path: string, size: number) => void;
  onMenu: (path: string, x: number, y: number) => void;
}) {
  const root = report.root;
  const [open, setOpen] = useState<Set<string>>(() => new Set([root]));
  const [picked, setPicked] = useState(root);
  const now = Date.now();
  // The icon theme the file list uses (Settings › Editor), so a folder looks the same in both.
  const theme = themeById(useEditorSettings().iconTheme);

  // The rows on screen: each open folder's children, then what they leave over as one row.
  const { rows, byPath } = useMemo(() => {
    const rows: Row[] = [], byPath = new Map<string, UsageNode>();
    const walk = (n: UsageNode, path: string, depth: number) => {
      byPath.set(path, n);
      if (!open.has(path)) return;
      for (const c of n.children) {
        const p = joinPath(path, c.name);
        if (gone.has(p)) continue;
        rows.push({ node: c, path: p, depth, size: c.size, share: n.size ? c.size / n.size : 0, parent: path });
        walk(c, p, depth + 1);
      }
      const rest = restOf(n);
      if (rest > 0 && n.children.length) rows.push({ node: null, path: `${path}\0rest`, depth, size: rest, share: n.size ? rest / n.size : 0, parent: path });
    };
    walk(report.tree, root, 0);
    return { rows, byPath };
  }, [report, open, gone, root]);

  const sel = byPath.get(picked) ?? report.tree;
  const toggle = (p: string) => setOpen((o) => { const n = new Set(o); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  // The selected folder's ring: its largest folders, then the rest together, and a drive's free space.
  const parts: Part[] = sel.children.filter((c) => !gone.has(joinPath(picked, c.name))).slice(0, 6)
    .map((c, i) => ({ name: c.name, size: c.size, color: PART_COLORS[i] }));
  const others = sel.size - parts.reduce((s, p) => s + p.size, 0);
  if (others > 0) parts.push({ name: sel.children.length > 6 ? "Everything else" : "Files in it", size: others, color: PART_COLORS[7] });
  if (picked === root && free != null) parts.push({ name: "Free space", size: free, color: "#94a3b8", faint: true });

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={grid + " h-8 shrink-0 border-b border-subtle px-4 text-[11.5px] text-text-muted"}>
          <span>Name</span><span className="text-right">Size</span><span>Share of the folder above</span><span className="text-right">Files</span><span>Last change</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1" role="tree" aria-label={`Folders in ${report.tree.name}`}>
          {rows.map((r) => {
            const isOpen = open.has(r.path), hasKids = !!r.node?.children.length;
            return (
              <div key={r.path} role="treeitem" aria-expanded={hasKids ? isOpen : undefined} aria-selected={picked === r.path}
                onClick={() => r.node && setPicked(r.path)} onDoubleClick={() => r.node && onOpen(r.path)}
                onContextMenu={(e) => { if (!r.node) return; e.preventDefault(); setPicked(r.path); onMenu(r.path, e.clientX, e.clientY); }}
                className={grid + " h-8 cursor-default px-4 text-[12.5px] hover:bg-white/5 " + (picked === r.path ? "bg-[var(--accent-soft)]" : "")}>
                <span className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: r.depth * 18 }}>
                  {hasKids
                    ? <button aria-label={isOpen ? "Fold" : "Unfold"} onClick={(e) => { e.stopPropagation(); toggle(r.path); }} className="grid size-4 shrink-0 place-items-center rounded text-text-muted hover:text-text-primary">
                        <ChevronRight size={12} style={{ transform: isOpen ? "rotate(90deg)" : undefined }} />
                      </button>
                    : <span className="size-4 shrink-0" />}
                  {r.node ? <FileIcon icon={theme.folder(r.node.name, isOpen)} size={15} /> : <FilesIcon size={14} className="shrink-0 text-text-muted" />}
                  <span className={"truncate " + (r.node ? "text-text-primary" : "italic text-text-muted")}>{r.node ? r.node.name : "Files and smaller folders"}</span>
                </span>
                <span className="text-right tabular-nums text-text-secondary">{sizeLabel(r.size)}</span>
                <span className="flex items-center gap-2">
                  <span className="h-2 flex-1 overflow-hidden rounded-sm bg-white/5">
                    <span className="block h-full rounded-sm" style={{ width: `${r.share * 100}%`, background: r.depth === 0 ? "var(--accent)" : `color-mix(in srgb, var(--accent) ${Math.max(45, 85 - r.depth * 15)}%, white)` }} />
                  </span>
                  <span className="w-11 text-right tabular-nums text-text-muted">{(r.share * 100).toFixed(1)}%</span>
                </span>
                <span className="text-right tabular-nums text-text-muted">{r.node ? r.node.files.toLocaleString() : ""}</span>
                <span className="text-text-muted">{r.node ? agoLabel(r.node.newest, now) : ""}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-subtle p-4 text-[12.5px]">
        <div className="flex flex-col gap-1">
          <span className="truncate text-[14px] font-semibold text-text-primary">{sel.name}</span>
          <span className="break-all font-mono text-[11px] text-text-muted">{picked}</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {[["Size", sizeLabel(sel.size)], [picked === root ? "Last change" : `Of ${report.tree.name}`, picked === root ? agoLabel(sel.newest, now) : `${((sel.size / (report.tree.size || 1)) * 100).toFixed(1)}%`],
            ["Files", sel.files.toLocaleString()], ["Folders listed", sel.children.length.toLocaleString()]].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 rounded-lg bg-elev p-2.5">
              <span className="text-[11.5px] text-text-muted">{k}</span>
              <span className="text-[15px] font-semibold text-text-primary">{v}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[11.5px] font-semibold text-text-muted">Inside it</span>
          <Donut parts={parts} title={sizeLabel(sel.size)} caption={picked === root && free != null ? `used, ${sizeLabel(free)} free` : `in ${sel.name}`}
            onPick={(name) => { const p = joinPath(picked, name); if (byPath.has(p) || sel.children.some((c) => c.name === name)) { setOpen((o) => new Set(o).add(picked)); setPicked(p); } }} />
        </div>
        <div className="mt-auto flex flex-col gap-1.5">
          <button onClick={() => onOpen(picked)} className="h-8 rounded-lg border border-subtle bg-elev text-text-secondary hover:border-strong hover:text-text-primary">Open in Files</button>
          <button onClick={() => void fsReveal(picked).catch((e: unknown) => console.warn("[files] reveal failed", e))} className="h-8 rounded-lg border border-subtle bg-elev text-text-secondary hover:border-strong hover:text-text-primary">Show in its folder</button>
          {picked !== root && <button onClick={() => onTrash(picked, sel.size)} className="h-8 rounded-lg border border-red-400/35 bg-red-400/10 text-red-300 hover:bg-red-400/15">Move to the bin…</button>}
        </div>
      </div>
    </div>
  );
}
