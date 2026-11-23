// The Duplicates tab: on request, the report's large files that share a size are compared by content,
// largest first, a group at a time (Deck's fsHash), so sets appear as they are found and Stop is
// honoured between groups. Each set keeps its newest copy unticked.
import { useEffect, useRef, useState } from "react";
import type { UsageFile } from "../../shim/bridge.js";
import { fsHash, isWindows } from "../../shim/bridge.js";
import { ConfirmDialog, type ConfirmState } from "../../shim/ui.js";
import { sizeLabel, baseName } from "../logic";
import { remove } from "../ops";
import { notice, failure } from "../notice";
import { agoLabel, type Report } from "./report";
import { freeable, sameContent, sameSize } from "./dupes";

const btn = "h-[30px] rounded-lg border border-subtle bg-elev px-3 text-[12.5px] text-text-secondary transition-colors hover:border-strong hover:text-text-primary disabled:opacity-40";

export function DupesTab({ report, gone, onGone }: { report: Report; gone: Set<string>; onGone: (p: string[]) => void }) {
  const [sets, setSets] = useState<UsageFile[][]>([]);
  const [run, setRun] = useState<{ done: number; total: number; on: boolean } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const stop = useRef(false);
  useEffect(() => () => { stop.current = true; }, []);

  const find = async () => {
    stop.current = false;
    setSets([]); setTicked(new Set());
    const groups = sameSize(report.big.filter((f) => !gone.has(f.path)));
    const total = groups.reduce((s, g) => s + g.length, 0);
    let done = 0;
    setRun({ done, total, on: true });
    for (const g of groups) {
      if (stop.current) break;
      try {
        const found = sameContent(g, await fsHash(g.map((f) => f.path)));
        if (found.length) {
          setSets((s) => [...s, ...found]);
          setTicked((t) => new Set([...t, ...found.flatMap((set) => set.slice(1).map((f) => f.path))]));
        }
      } catch (e) { console.warn("[files] comparing files failed", e); }
      done += g.length;
      setRun({ done, total, on: true });
    }
    setRun({ done, total, on: false });
  };

  const shown = sets.map((s) => s.filter((f) => !gone.has(f.path))).filter((s) => s.length > 1);
  const chosen = shown.flat().filter((f) => ticked.has(f.path));
  const toggle = (p: string) => setTicked((t) => { const n = new Set(t); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const bin = isWindows() ? "the Recycle Bin" : "the Trash";
  const trash = () => setConfirm({
    title: `Move ${chosen.length} cop${chosen.length === 1 ? "y" : "ies"} to ${bin}?`,
    body: `${sizeLabel(chosen.reduce((s, f) => s + f.size, 0))} in all. Every set keeps at least the copies left unticked.`,
    confirmLabel: "Move", danger: false,
    onConfirm: () => {
      const paths = chosen.map((f) => f.path);
      void remove(paths, false).then(() => { onGone(paths); setTicked(new Set()); notice(`${paths.length} duplicate${paths.length === 1 ? "" : "s"} moved to ${bin}`); },
        (e: unknown) => { console.warn("[files] moving duplicates failed", e); failure("Moving to the bin failed", String(e).replace(/^Error: /, "")); });
    },
  });
  // Every set must keep one: ticking all of a set is not offered for the bin.
  const safe = shown.every((s) => s.some((f) => !ticked.has(f.path)));

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex h-14 shrink-0 items-center gap-3.5 border-b border-subtle px-4 text-[12.5px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-text-primary">
            {run ? <><span className="font-semibold">{shown.length} set{shown.length === 1 ? "" : "s"} of identical files</span><span className="text-text-secondary">{run.on ? " so far" : ""} · {sizeLabel(freeable(shown))} could be freed</span></> : "Find files that are exact copies of each other"}
          </span>
          <span className="text-[12px] text-text-muted">Among the {report.big.length.toLocaleString()} largest files: the ones that share a size are compared by content, largest first</span>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          {run?.on ? <>
            <span className="text-text-secondary">Comparing {run.done.toLocaleString()} of {run.total.toLocaleString()} files</span>
            <span className="h-1.5 w-40 overflow-hidden rounded-full bg-elev"><span className="block h-full" style={{ width: `${(run.done / Math.max(1, run.total)) * 100}%`, background: "var(--accent)" }} /></span>
            <button className={btn} onClick={() => { stop.current = true; }}>Stop</button>
          </> : <button className={btn} onClick={() => void find()}>{run ? "Compare again" : "Find duplicates"}</button>}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
        {run && !run.on && !shown.length && <span className="m-auto text-[12.5px] text-text-muted">No copies found among these files.</span>}
        {shown.map((set) => (
          <div key={set[0].path} className="flex flex-col overflow-hidden rounded-lg border border-subtle">
            <div className="flex h-9 items-center gap-2.5 bg-panel px-3 text-[12.5px]">
              <span className="font-semibold text-text-primary">{baseName(set[0].path)}</span>
              <span className="text-text-muted">{sizeLabel(set[0].size)} × {set.length}</span>
              <span className="ml-auto" style={{ color: "var(--accent)" }}>{sizeLabel(set[0].size * (set.length - 1))} could be freed</span>
            </div>
            {set.map((f, i) => (
              <label key={f.path} className="grid h-8 cursor-pointer grid-cols-[28px_minmax(0,1fr)_120px_60px] items-center gap-3 border-t border-white/[0.04] px-3 text-[12.5px] hover:bg-white/5">
                <input type="checkbox" checked={ticked.has(f.path)} onChange={() => toggle(f.path)} aria-label="Select this copy" style={{ accentColor: "var(--accent)" }} />
                <span className="truncate font-mono text-[11.5px] text-text-secondary" title={f.path}>{f.path}</span>
                <span className="text-text-muted">{agoLabel(f.mtime, Date.now())}</span>
                {i === 0 ? <span className="justify-self-end rounded-full bg-teal-400/15 px-2 text-[11px] text-teal-300">Newest</span> : <span />}
              </label>
            ))}
          </div>
        ))}
      </div>
      {shown.length > 0 && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-t border-subtle bg-panel px-4 text-[12.5px] text-text-secondary">
          <button className={btn} onClick={() => setTicked(new Set(shown.flatMap((s) => s.slice(1).map((f) => f.path))))}>Select all but the newest in each set</button>
          <span className="ml-2">{chosen.length} selected · {sizeLabel(chosen.reduce((s, f) => s + f.size, 0))}</span>
          {!safe && <span className="text-amber-300">Leave one copy of each set unticked</span>}
          <button disabled={!chosen.length || !safe} onClick={trash}
            className="ml-auto h-[30px] rounded-lg border border-red-400/35 bg-red-400/10 px-3 text-[12.5px] text-red-300 hover:bg-red-400/15 disabled:opacity-40">Move to {bin}…</button>
        </div>
      )}
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
