// A list of files from a report (Largest files, a bucket of Age): ticked ones can be revealed or sent
// to the Recycle Bin, and a file deleted here leaves the list at once.
import { useState } from "react";
import { fsReveal, isWindows } from "../../shim/bridge.js";
import type { UsageFile } from "../../shim/bridge.js";
import { ConfirmDialog, type ConfirmState } from "../../shim/ui.js";
import { sizeLabel, parentOf, baseName } from "../logic";
import { remove } from "../ops";
import { notice, failure } from "../notice";
import { agoLabel, kindOf } from "./report";

const btn = "h-[30px] rounded-lg border border-subtle bg-elev px-3 text-[12.5px] text-text-secondary transition-colors hover:border-strong hover:text-text-primary disabled:opacity-40";

export function FileList({ files, gone, onGone, empty }: {
  files: UsageFile[]; gone: Set<string>; onGone: (paths: string[]) => void; empty: string;
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const shown = files.filter((f) => !gone.has(f.path));
  const chosen = shown.filter((f) => ticked.has(f.path));
  const now = Date.now();
  const toggle = (p: string) => setTicked((t) => { const n = new Set(t); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const bin = isWindows() ? "the Recycle Bin" : "the Trash";
  const trash = () => setConfirm({
    title: `Move ${chosen.length === 1 ? baseName(chosen[0].path) : `${chosen.length} files`} to ${bin}?`,
    body: `${sizeLabel(chosen.reduce((s, f) => s + f.size, 0))} in all. They can be restored from ${bin}.`,
    confirmLabel: "Move", danger: false,
    onConfirm: () => {
      const paths = chosen.map((f) => f.path);
      void remove(paths, false).then(() => { onGone(paths); setTicked(new Set()); notice(`${paths.length === 1 ? "1 file" : `${paths.length} files`} moved to ${bin}`); },
        (e: unknown) => { console.warn("[files] moving to the bin failed", e); failure("Moving to the bin failed", String(e).replace(/^Error: /, "")); });
    },
  });
  if (!shown.length) return <div className="flex flex-1 items-center justify-center text-[12.5px] text-text-muted">{empty}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid h-8 shrink-0 grid-cols-[28px_minmax(0,1.1fr)_minmax(0,1.4fr)_100px_90px_120px] items-center gap-3 border-b border-subtle px-4 text-[11.5px] text-text-muted">
        <span /><span>Name</span><span>Folder</span><span>Kind</span><span className="text-right">Size</span><span>Last change</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((f) => (
          <label key={f.path} onDoubleClick={() => void fsReveal(f.path).catch((e: unknown) => console.warn("[files] reveal failed", e))}
            className={"grid h-8 cursor-pointer grid-cols-[28px_minmax(0,1.1fr)_minmax(0,1.4fr)_100px_90px_120px] items-center gap-3 px-4 text-[12.5px] hover:bg-white/5 " + (ticked.has(f.path) ? "bg-[var(--accent-soft)]" : "")}>
            <input type="checkbox" checked={ticked.has(f.path)} onChange={() => toggle(f.path)} aria-label={`Select ${baseName(f.path)}`} style={{ accentColor: "var(--accent)" }} />
            <span className="truncate text-text-primary" title={f.path}>{baseName(f.path)}</span>
            <span className="truncate font-mono text-[11px] text-text-muted" title={parentOf(f.path) ?? ""}>{parentOf(f.path)}</span>
            <span className="truncate text-text-muted">{kindOf(baseName(f.path).split(".").pop()?.toLowerCase() ?? "").name}</span>
            <span className="text-right tabular-nums text-text-secondary">{sizeLabel(f.size)}</span>
            <span className="text-text-muted">{agoLabel(f.mtime, now)}</span>
          </label>
        ))}
      </div>
      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-subtle bg-panel px-4 text-[12.5px] text-text-secondary">
        <span>{chosen.length ? `${chosen.length} selected · ${sizeLabel(chosen.reduce((s, f) => s + f.size, 0))}` : `${shown.length} files · double-click one to show it in its folder`}</span>
        <div className="ml-auto flex gap-2">
          <button className={btn} disabled={chosen.length !== 1} onClick={() => void fsReveal(chosen[0].path).catch((e: unknown) => console.warn("[files] reveal failed", e))}>Show in folder</button>
          <button disabled={!chosen.length} onClick={trash}
            className="h-[30px] rounded-lg border border-red-400/35 bg-red-400/10 px-3 text-[12.5px] text-red-300 transition-colors hover:bg-red-400/15 disabled:opacity-40">Move to {bin}…</button>
        </div>
      </div>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
