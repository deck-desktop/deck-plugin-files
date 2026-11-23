// The question asked when a pasted or dropped item's name is already in the folder: replace it, keep
// both, or skip, and maybe the same for the rest. Moved out of Files.tsx.
import { useState } from "react";
import { Check } from "lucide-react";
import { isWindows } from "../shim/bridge.js";
import type { Choice } from "./ops";
import type { Clash } from "./logic";

/** Where a deleted file goes on this PC: the Recycle Bin on Windows, the Trash elsewhere. */
export const BIN = () => (isWindows() ? "the Recycle Bin" : "the Trash");

/** A name clash being asked about, and how the answer is handed back. */
export interface Asking { clash: Clash; rest: number; resolve: (a: { choice: Choice; forRest: boolean }) => void }

/** A name already in the folder: what to do with it, and maybe with the rest. */
export function ClashDialog({ a, onDone }: { a: Asking; onDone: (ans: { choice: Choice; forRest: boolean }) => void }) {
  const [forRest, setForRest] = useState(false);
  const btn = "h-8 rounded-lg border border-subtle bg-elev px-3 text-[12.5px] text-text-secondary transition-colors hover:border-strong hover:text-text-primary";
  const pick = (choice: Choice) => onDone({ choice, forRest });
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50" onKeyDown={(e) => { if (e.key === "Escape") pick("skip"); }}>
      <div role="dialog" aria-label="A file with this name is already here" className="flex w-[460px] flex-col gap-4 rounded-2xl border border-subtle bg-card p-5 shadow-2xl">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold text-text-primary">{a.clash.name} is already there</span>
          <span className="text-[12.5px] text-text-secondary">
            {a.clash.folder ? "A folder cannot be replaced by a copy, only kept beside it with a new name, or skipped." : `Replace it (the old one goes to ${BIN()}), keep both, or skip this one.`}
          </span>
        </div>
        {a.rest > 0 && (
          <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
            <input type="checkbox" checked={forRest} onChange={(e) => setForRest(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
            Do the same for the other {a.rest}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button className={btn} onClick={() => pick("skip")}>Skip</button>
          <button className={btn} onClick={() => pick("both")}>Keep both</button>
          {!a.clash.folder && (
            <button autoFocus onClick={() => pick("replace")} className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-white transition hover:brightness-110" style={{ background: "var(--accent)" }}>
              <Check size={13} />Replace
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
