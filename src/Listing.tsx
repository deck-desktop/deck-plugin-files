// The folder's entries, as a table (Details) or as tiles (Grid). Selection, renaming and the
// keyboard live in Files.tsx; this draws them and reports what was clicked.
import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { FileIcon, themeById, useEditorSettings } from "../shim/ui.js";
import { isRemote, previewKind, sizeLabel, typeLabel, type Entry, type SortKey } from "./logic";
import { when } from "./Preview";
import { useThumb } from "./thumbs";

export interface ListProps {
  entries: Entry[];
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
      <div role="grid" aria-label="Files" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 py-1"
        onContextMenu={(ev) => { if (ev.target === ev.currentTarget) { ev.preventDefault(); p.onMenu(null, ev); } }}>
        {p.entries.map((e) => {
          const on = p.selected.has(e.path);
          return (
            <div key={e.path} role="row" aria-selected={on} data-path={e.path}
              onMouseDown={(ev) => p.onPick(e, ev)} onDoubleClick={() => p.onOpen(e)}
              onContextMenu={(ev) => { ev.preventDefault(); p.onMenu(e, ev); }}
              className={COLS + " h-[30px] cursor-default select-none items-center rounded-md px-2.5 text-[12.5px] "
                + (on ? "bg-[var(--accent-soft)] text-text-primary" : "text-text-secondary hover:bg-white/5")
                + (p.focus === e.path ? " outline outline-1 outline-[var(--accent)]" : "")
                + (p.cut.has(e.path) || e.hidden ? " opacity-55" : "")}>
              <span className="flex min-w-0 items-center gap-2">
                <FileIcon icon={e.dir ? theme.folder(e.name, false) : theme.file(e.name)} size={15} />
                {p.renaming === e.path ? <RenameBox e={e} onRename={p.onRename} /> : <span className="truncate">{e.name}</span>}
              </span>
              <span className="truncate text-text-muted">{when(e.mtimeMs)}</span>
              <span className="truncate text-text-muted">{typeLabel(e)}</span>
              <span className="text-right text-text-muted">{e.dir ? "" : sizeLabel(e.size)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TILE = [0, 96, 132, 180, 240];

function Tile({ e, size, on, focus, dim, renaming, p }: { e: Entry; size: number; on: boolean; focus: boolean; dim: boolean; renaming: boolean; p: ListProps }) {
  const theme = themeById(useEditorSettings().iconTheme);
  const kind = previewKind(e.name);
  const thumbable = !e.dir && !isRemote(e.path) && (kind === "image" || kind === "media" || kind === "pdf");
  const url = useThumb(e.path, e.mtimeMs, Math.round(TILE[size] * 1.5), thumbable);
  return (
    <div role="gridcell" aria-selected={on} data-path={e.path}
      onMouseDown={(ev) => p.onPick(e, ev)} onDoubleClick={() => p.onOpen(e)}
      onContextMenu={(ev) => { ev.preventDefault(); p.onMenu(e, ev); }}
      className={"flex cursor-default select-none flex-col gap-1.5 rounded-lg p-1.5 "
        + (on ? "bg-[var(--accent-soft)]" : "hover:bg-white/5") + (focus ? " outline outline-1 outline-[var(--accent)]" : "") + (dim ? " opacity-55" : "")}>
      <div className="grid place-items-center overflow-hidden rounded-md bg-elev" style={{ height: Math.round(TILE[size] * 0.75) }}>
        {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" />
          : <FileIcon icon={e.dir ? theme.folder(e.name, false) : theme.file(e.name)} size={Math.round(TILE[size] / 3)} />}
      </div>
      {renaming ? <RenameBox e={e} onRename={p.onRename} />
        : <span className={"line-clamp-2 break-all text-center text-[12px] " + (on ? "text-text-primary" : "text-text-secondary")}>{e.name}</span>}
    </div>
  );
}

export function Grid(p: ListProps & { size: number }) {
  return (
    <div role="grid" aria-label="Files" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3"
      onContextMenu={(ev) => { if (ev.target === ev.currentTarget) { ev.preventDefault(); p.onMenu(null, ev); } }}>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE[p.size]}px, 1fr))` }}
        onContextMenu={(ev) => { if (ev.target === ev.currentTarget) { ev.preventDefault(); p.onMenu(null, ev); } }}>
        {p.entries.map((e) => (
          <Tile key={e.path} e={e} size={p.size} on={p.selected.has(e.path)} focus={p.focus === e.path}
            dim={p.cut.has(e.path) || e.hidden} renaming={p.renaming === e.path} p={p} />
        ))}
      </div>
    </div>
  );
}
