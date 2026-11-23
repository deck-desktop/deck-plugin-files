// The Age tab: the space by when files last changed. A bucket picked shows its largest files.
import { useMemo, useState } from "react";
import type { UsageFile } from "../../shim/bridge.js";
import { sizeLabel } from "../logic";
import { AGE_LABELS, ageBucket, type Report } from "./report";
import { FileList } from "./FileList";

export function AgeTab({ report, gone, onGone }: { report: Report; gone: Set<string>; onGone: (p: string[]) => void }) {
  const [bucket, setBucket] = useState(AGE_LABELS.length - 1);
  const max = Math.max(1, ...report.ages.map((a) => a[0]));
  const now = Date.now();
  const files: UsageFile[] = useMemo(() => report.big.filter((f) => ageBucket(f.mtime, now) === bucket), [report.big, bucket]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      <span className="px-4 pt-4 text-[12.5px] text-text-muted">Space by when a file last changed</span>
      <div className="grid shrink-0 grid-cols-6 gap-4 border-b border-subtle px-8 pb-4 pt-2">
        {report.ages.map(([size, count], i) => (
          <button key={i} onClick={() => setBucket(i)} className="flex flex-col items-stretch gap-1.5 text-center">
            <span className="flex h-[180px] flex-col justify-end gap-1.5">
              <span className="text-[13px] font-semibold text-text-primary">{sizeLabel(size)}</span>
              <span className="rounded-t" style={{ height: `${Math.max(2, (size / max) * 140)}px`, background: "var(--accent)", opacity: i === bucket ? 1 : 0.35 }} />
            </span>
            <span className={"text-[12px] " + (i === bucket ? "font-semibold text-text-primary" : "text-text-secondary")}>{AGE_LABELS[i]}</span>
            <span className="text-[11.5px] text-text-muted">{count.toLocaleString()} files</span>
          </button>
        ))}
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2.5 px-4 text-[12.5px]">
        <span className="font-semibold text-text-primary">{AGE_LABELS[bucket]}</span>
        <span className="text-text-muted">its largest files</span>
      </div>
      <FileList key={bucket} files={files} gone={gone} onGone={onGone} empty="No file of 1 MB or more changed then." />
    </div>
  );
}
