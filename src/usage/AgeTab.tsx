// The Age tab: the space by when files last changed. A bucket picked shows its largest files.
import { useMemo, useState } from "react";
import type { UsageFile } from "../../shim/bridge.js";
import { sizeLabel } from "../logic";
import { AGE_LABELS, ageBucket, type Report } from "./report";
import { FileList } from "./FileList";

export function AgeTab({ report, gone, onGone, onOpenFolder }: { report: Report; gone: Set<string>; onGone: (p: string[]) => void; onOpenFolder: (dir: string) => void }) {
  const [bucket, setBucket] = useState(AGE_LABELS.length - 1);
  const max = Math.max(1, ...report.ages.map((a) => a[0]));
  const now = Date.now();
  const files: UsageFile[] = useMemo(() => report.big.filter((f) => ageBucket(f.mtime, now) === bucket), [report.big, bucket]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* One compact card a bucket, its bar along its foot: the list under them keeps the height, which
          a chart of tall columns took on a small window. */}
      <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2 border-b border-subtle p-3" role="tablist" aria-label="Space by when a file last changed">
        {report.ages.map(([size, count], i) => (
          <button key={i} role="tab" aria-selected={i === bucket} onClick={() => setBucket(i)}
            className={"flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors " + (i === bucket ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-subtle bg-elev hover:border-strong")}>
            <span className={"text-[12px] " + (i === bucket ? "font-semibold text-text-primary" : "text-text-secondary")}>{AGE_LABELS[i]}</span>
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold text-text-primary">{sizeLabel(size)}</span>
              <span className="text-[11px] text-text-muted">{count.toLocaleString()} files</span>
            </span>
            <span className="h-1 overflow-hidden rounded-full bg-white/5"><span className="block h-full rounded-full" style={{ width: `${Math.max(1, (size / max) * 100)}%`, background: "var(--accent)" }} /></span>
          </button>
        ))}
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2.5 px-4 text-[12.5px]">
        <span className="font-semibold text-text-primary">{AGE_LABELS[bucket]}</span>
        <span className="text-text-muted">its largest files</span>
      </div>
      <FileList key={bucket} files={files} gone={gone} onGone={onGone} onOpenFolder={onOpenFolder} empty="No file of 1 MB or more changed then." />
    </div>
  );
}
