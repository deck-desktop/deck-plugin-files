// A list of files from a report (Largest files, a bucket of Age): ticked ones can be revealed or sent
// to the Recycle Bin, and a file deleted here leaves the list at once.
import { useMemo, useState } from "react";
import { fsOpen, fsReveal, isWindows } from "../../shim/bridge.js";
import type { UsageFile } from "../../shim/bridge.js";
import { ConfirmDialog, ContextMenu, FileIcon, themeById, useEditorSettings, type ConfirmState, type MenuEntry } from "../../shim/ui.js";
import { sizeLabel, parentOf, baseName } from "../logic";
import { remove } from "../ops";
import { notice, failure } from "../notice";
import { agoLabel, kindOf } from "./report";

/** Rows drawn at first, and added each time the list is scrolled near its end. */
const PAGE = 150;

type SortKey = "name" | "folder" | "kind" | "size" | "mtime";
const extOf = (p: string) => baseName(p).split(".").pop()?.toLowerCase() ?? "";
const KEYS: Record<SortKey, (f: UsageFile) => string | number> = {
  name: (f) => baseName(f.path).toLowerCase(), folder: (f) => (parentOf(f.path) ?? "").toLowerCase(),
  kind: (f) => kindOf(extOf(f.path)).name, size: (f) => f.size, mtime: (f) => f.mtime,
};
/** The files ordered by one column; ties keep the larger file first. */
function sortFiles(files: UsageFile[], key: SortKey, asc: boolean): UsageFile[] {
  const k = KEYS[key];
  return [...files].sort((a, b) => {
    const x = k(a), y = k(b);
    const c = typeof x === "number" ? x - (y as number) : x.localeCompare(y as string);
    return (asc ? c : -c) || b.size - a.size;
  });
}

const btn ="h-[30px] rounded-lg border border-subtle bg-elev px-3 text-[12.5px] text-text-secondary transition-colors hover:border-strong hover:text-text-primary disabled:opacity-40";

export function FileList({ files, gone, onGone, empty, onOpenFolder }: {
  files: UsageFile[]; gone: Set<string>; onGone: (paths: string[]) => void; empty: string;
  /** Show a folder in Files (the report closes over it). */
  onOpenFolder: (dir: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  // Largest first until a heading is clicked; a second click on it turns the order round.
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "size", asc: false });
  const shown = useMemo(() => sortFiles(files.filter((f) => !gone.has(f.path)), sort.key, sort.asc), [files, gone, sort]);
  // A page of rows at a time: the list can hold thousands, and drawing them all at once made opening
  // the tab heavy. More are added at the foot of the list as it is scrolled there.
  const [limit, setLimit] = useState(PAGE);
  const head = (key: SortKey, label: string, right = false) => (
    <button onClick={() => setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === "name" || key === "folder" || key === "kind" }))}
      className={"flex items-center gap-1 truncate hover:text-text-primary " + (right ? "justify-end " : "") + (sort.key === key ? "text-text-secondary" : "")}>
      {label}{sort.key === key && <span aria-hidden>{sort.asc ? "▲" : "▼"}</span>}
    </button>
  );
  const chosen = shown.filter((f) => ticked.has(f.path));
  const now = Date.now();
  const theme = themeById(useEditorSettings().iconTheme);
  const toggle = (p: string) => setTicked((t) => { const n = new Set(t); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const bin = isWindows() ? "the Recycle Bin" : "the Trash";
  const trash = (list = chosen) => setConfirm({
    title: `Move ${list.length === 1 ? baseName(list[0].path) : `${list.length} files`} to ${bin}?`,
    body: `${sizeLabel(list.reduce((s, f) => s + f.size, 0))} in all. They can be restored from ${bin}.`,
    confirmLabel: "Move", danger: false,
    onConfirm: () => {
      const paths = list.map((f) => f.path);
      void remove(paths, false).then(() => { onGone(paths); setTicked(new Set()); notice(`${paths.length === 1 ? "1 file" : `${paths.length} files`} moved to ${bin}`); },
        (e: unknown) => { console.warn("[files] moving to the bin failed", e); failure("Moving to the bin failed", String(e).replace(/^Error: /, "")); });
    },
  });
  const warn = (what: string) => (e: unknown) => console.warn(`[files] ${what} failed`, e);
  // A row's menu: for it alone, or for every ticked file when it is one of them.
  const rowMenu = (f: UsageFile, x: number, y: number) => {
    const list = ticked.has(f.path) && chosen.length > 1 ? chosen : [f];
    const one = list.length === 1;
    setMenu({ x, y, items: [
      ...(one ? [
        { label: "Open", onClick: () => void fsOpen(f.path).catch(warn("opening a file")) },
        { label: isWindows() ? "Show in Windows Explorer" : "Show in the file manager", onClick: () => void fsReveal(f.path).catch(warn("reveal")) },
        { label: "Open its folder in Files", onClick: () => { const d = parentOf(f.path); if (d) onOpenFolder(d); } },
      ] as MenuEntry[] : []),
      { label: one ? "Copy path" : `Copy ${list.length} paths`, onClick: () => void navigator.clipboard.writeText(list.map((x) => x.path).join("\r\n")).then(() => notice(one ? "Path copied" : `${list.length} paths copied`)) },
      "sep",
      { label: one ? `Move to ${bin}…` : `Move ${list.length} files to ${bin}…`, danger: true, onClick: () => trash(list) },
    ] });
  };
  if (!shown.length) return <div className="flex flex-1 items-center justify-center text-[12.5px] text-text-muted">{empty}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid h-8 shrink-0 grid-cols-[28px_minmax(0,1.1fr)_minmax(0,1.4fr)_100px_90px_120px] items-center gap-3 border-b border-subtle px-4 text-[11.5px] text-text-muted">
        <span />{head("name", "Name")}{head("folder", "Folder")}{head("kind", "Kind")}{head("size", "Size", true)}{head("mtime", "Last change")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => { const el = e.currentTarget; if (limit < shown.length && el.scrollTop + el.clientHeight > el.scrollHeight - 400) setLimit((n) => n + PAGE); }}>
        {shown.slice(0, limit).map((f) => (
          <label key={f.path} onContextMenu={(e) => { e.preventDefault(); rowMenu(f, e.clientX, e.clientY); }} onDoubleClick={() => void fsReveal(f.path).catch((e: unknown) => console.warn("[files] reveal failed", e))}
            className={"grid h-8 cursor-pointer grid-cols-[28px_minmax(0,1.1fr)_minmax(0,1.4fr)_100px_90px_120px] items-center gap-3 px-4 text-[12.5px] hover:bg-white/5 " + (ticked.has(f.path) ? "bg-[var(--accent-soft)]" : "")}>
            <input type="checkbox" checked={ticked.has(f.path)} onChange={() => toggle(f.path)} aria-label={`Select ${baseName(f.path)}`} style={{ accentColor: "var(--accent)" }} />
            <span className="flex min-w-0 items-center gap-2" title={f.path}><FileIcon icon={theme.file(baseName(f.path))} size={15} /><span className="truncate text-text-primary">{baseName(f.path)}</span></span>
            <span className="truncate font-mono text-[11px] text-text-muted" title={parentOf(f.path) ?? ""}>{parentOf(f.path)}</span>
            <span className="truncate text-text-muted">{kindOf(extOf(f.path)).name}</span>
            <span className="text-right tabular-nums text-text-secondary">{sizeLabel(f.size)}</span>
            <span className="text-text-muted">{agoLabel(f.mtime, now)}</span>
          </label>
        ))}
      </div>
      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-subtle px-4 text-[12.5px] text-text-secondary">
        <span>{chosen.length ? `${chosen.length} selected · ${sizeLabel(chosen.reduce((s, f) => s + f.size, 0))}` : `${shown.length} files · double-click one to show it in its folder`}</span>
        <div className="ml-auto flex gap-2">
          <button className={btn} disabled={chosen.length !== 1} onClick={() => void fsReveal(chosen[0].path).catch((e: unknown) => console.warn("[files] reveal failed", e))}>Show in folder</button>
          <button disabled={!chosen.length} onClick={() => trash()}
            className="h-[30px] rounded-lg border border-red-400/35 bg-red-400/10 px-3 text-[12.5px] text-red-300 transition-colors hover:bg-red-400/15 disabled:opacity-40">Move to {bin}…</button>
        </div>
      </div>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
