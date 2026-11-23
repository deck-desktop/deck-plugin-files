// The Types tab: the space by kind as one bar, then by extension. A type picked shows its largest files.
import { useMemo } from "react";
import { sizeLabel } from "../logic";
import { byKind, kindOf, type Report } from "./report";

export function TypesTab({ report, onPick }: { report: Report; onPick: (ext: string) => void }) {
  const kinds = useMemo(() => byKind(report.types), [report.types]);
  const total = report.tree.size || 1;
  const grid = "grid grid-cols-[130px_120px_minmax(0,1fr)_96px_96px_90px] items-center gap-3";
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <div className="flex shrink-0 flex-col gap-2.5 p-4">
        <div className="flex h-3.5 gap-0.5 overflow-hidden rounded">
          {kinds.map((k) => <div key={k.name} title={`${k.name}: ${sizeLabel(k.size)}`} style={{ flex: `${k.size} 1 0`, background: k.color, opacity: 0.75 }} />)}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
          {kinds.map((k) => (
            <span key={k.name} className="flex items-center gap-1.5 text-text-secondary">
              <span className="size-2.5 rounded-sm" style={{ background: k.color }} />{k.name}<span className="text-text-muted">{sizeLabel(k.size)}</span>
            </span>
          ))}
        </div>
      </div>
      <div className={grid + " h-8 shrink-0 border-y border-subtle px-4 text-[11.5px] text-text-muted"}>
        <span>Type</span><span>Kind</span><span>Share of {report.tree.name}</span><span className="text-right">Size</span><span className="text-right">Files</span><span className="text-right">Average</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {report.types.slice(0, 300).map((t) => {
          const k = kindOf(t.ext);
          return (
            <button key={t.ext} onClick={() => onPick(t.ext)} className={grid + " h-8 w-full px-4 text-left text-[12.5px] hover:bg-white/5"}>
              <span className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-sm" style={{ background: k.color }} /><span className="truncate font-mono text-[12px] text-text-primary">{t.ext ? `.${t.ext}` : "(none)"}</span></span>
              <span className="text-text-muted">{k.name}</span>
              <span className="h-2 overflow-hidden rounded-sm bg-white/5"><span className="block h-full rounded-sm" style={{ width: `${Math.max(0.5, (t.size / total) * 100)}%`, background: k.color, opacity: 0.75 }} /></span>
              <span className="text-right tabular-nums text-text-secondary">{sizeLabel(t.size)}</span>
              <span className="text-right tabular-nums text-text-muted">{t.count.toLocaleString()}</span>
              <span className="text-right tabular-nums text-text-muted">{sizeLabel(t.size / t.count)}</span>
            </button>
          );
        })}
      </div>
      <div className="flex h-9 shrink-0 items-center border-t border-subtle px-4 text-[12px] text-text-muted">Click a type to see its largest files</div>
    </div>
  );
}
