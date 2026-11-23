// A ring of parts with the total in its middle and a list under it: what a folder holds, and at a
// drive's root its free space as a faint part of its own.
import { sizeLabel } from "../logic";

export interface Part { name: string; size: number; color: string; faint?: boolean }

export function Donut({ parts, title, caption, size = 170, onPick }: {
  parts: Part[]; title: string; caption: string; size?: number; onPick?: (name: string) => void;
}) {
  const total = parts.reduce((s, p) => s + p.size, 0) || 1;
  const r = size * 0.39, stroke = size * 0.155, c = 2 * Math.PI * r;
  let at = 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative grid place-items-center" style={{ height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}, by part`}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`} fill="none" strokeWidth={stroke}>
            {parts.map((p) => {
              const len = (p.size / total) * c;
              const el = len > 0.5 && (
                <circle key={p.name} cx={size / 2} cy={size / 2} r={r} stroke={p.color} strokeOpacity={p.faint ? 0.18 : 0.9}
                  strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${c}`} strokeDashoffset={-at} />
              );
              at += len;
              return el;
            })}
          </g>
        </svg>
        <div className="pointer-events-none absolute flex flex-col items-center">
          <span className="text-[15px] font-semibold text-text-primary">{title}</span>
          <span className="text-[11px] text-text-muted">{caption}</span>
        </div>
      </div>
      <div className="flex flex-col">
        {parts.map((p) => (
          <button key={p.name} disabled={!onPick || p.faint} onClick={() => onPick?.(p.name)}
            className="grid h-[22px] grid-cols-[10px_minmax(0,1fr)_64px_40px] items-center gap-2 rounded px-1 text-left text-[12px] enabled:hover:bg-white/5">
            <span className="size-2.5 rounded-sm" style={{ background: p.color, opacity: p.faint ? 0.35 : 1 }} />
            <span className={"truncate " + (p.faint ? "text-text-muted" : "text-text-secondary")}>{p.name}</span>
            <span className="text-right tabular-nums text-text-secondary">{sizeLabel(p.size)}</span>
            <span className="text-right tabular-nums text-text-muted">{Math.round((p.size / total) * 100)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The colours a folder's parts take, in order; the rest of them share the last. */
export const PART_COLORS = ["#4f8cff", "#2dd4bf", "#f59e0b", "#ec4899", "#a855f7", "#38bdf8", "#34d399", "#64748b"];
