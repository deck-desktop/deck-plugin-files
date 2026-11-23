// The Largest files tab: the report's large files, all or of one kind or type.
import { useMemo } from "react";
import { baseName } from "../logic";
import { byKind, kindOf, type Report } from "./report";
import { FileList } from "./FileList";
const extOf = (p: string) => { const n = baseName(p); const i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
const chip = (on: boolean) => "h-[30px] rounded-lg border px-3 text-[12.5px] transition-colors " + (on ? "border-[var(--accent)] bg-[var(--accent-soft)] text-text-primary" : "border-subtle bg-elev text-text-secondary hover:text-text-primary");

export function LargestTab({ report, gone, onGone, kind, setKind }: {
  report: Report; gone: Set<string>; onGone: (p: string[]) => void; kind: string | null; setKind: (k: string | null) => void;
}) {
  const kinds = useMemo(() => byKind(report.types).map((k) => k.name), [report.types]);
  const files = useMemo(() => report.big.filter((f) => !kind || kindOf(extOf(f.path)).name === kind || extOf(f.path) === kind), [report.big, kind]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-subtle px-4 py-2.5">
        <button className={chip(!kind)} onClick={() => setKind(null)}>All</button>
        {kinds.map((k) => <button key={k} className={chip(kind === k)} onClick={() => setKind(k)}>{k}</button>)}
        {kind && !kinds.includes(kind) && <button className={chip(true)}>.{kind}</button>}
        <span className="ml-auto text-[12px] text-text-muted">The largest {report.big.length.toLocaleString()} files of 1 MB or more</span>
      </div>
      <FileList files={files} gone={gone} onGone={onGone} empty="No files of 1 MB or more here." />
    </div>
  );
}
