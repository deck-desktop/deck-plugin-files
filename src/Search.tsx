// Search in the open folder: file names, and what is inside files (Deck's ripgrep, .gitignore
// respected). Neither can be stopped once started, so a whole drive is not searched: open a
// folder on it first.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fsFiles, fsSearch, type SearchHit } from "../shim/bridge.js";
import { FileIcon, themeById, useEditorSettings } from "../shim/ui.js";
import { baseName, nameMatches, parentOf } from "./logic";

const NAMES_MAX = 300;
const LINES_PER_FILE = 3;

export function Search({ cwd, query, mode, onMode, onOpenPath, onOpenLine }: {
  cwd: string; query: string; mode: "both" | "names"; onMode: (m: "both" | "names") => void;
  onOpenPath: (path: string) => void; onOpenLine: (path: string, line: number) => void;
}) {
  const theme = themeById(useEditorSettings().iconTheme);
  const [names, setNames] = useState<string[] | null>(null);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState("");
  const [took, setTook] = useState(0);
  const root = parentOf(cwd) === null;

  useEffect(() => {
    if (root || !query.trim()) return;
    let live = true;
    const t0 = performance.now();
    setNames(null); setHits(null); setError("");
    const byName = fsFiles(cwd).then((all: string[]) => { if (live) setNames(all.filter((p) => nameMatches(baseName(p), query)).slice(0, NAMES_MAX)); });
    const inside = mode === "both"
      ? fsSearch(cwd, query, { caseSensitive: false, isRegex: false, wholeWord: false, includes: "", excludes: "" }).then((h: SearchHit[]) => { if (live) setHits(h); })
      : Promise.resolve(live && setHits([]));
    void Promise.all([byName, inside]).then(() => { if (live) setTook(performance.now() - t0); }, (e: unknown) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [cwd, query, mode, root]);

  const files = new Map<string, SearchHit[]>();
  for (const h of hits ?? []) files.set(h.path, [...(files.get(h.path) ?? []), h]);
  const busy = names === null || hits === null;
  const rel = (p: string) => p.slice(cwd.length).replace(/^[\\/]/, "");
  const at = (p: string) => { const r = rel(p); const i = Math.max(r.lastIndexOf("\\"), r.lastIndexOf("/")); return i > 0 ? r.slice(0, i) : ""; };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-subtle px-3 text-[12px]">
        <div className="flex gap-0.5 rounded-lg border border-subtle bg-elev p-0.5">
          {(["both", "names"] as const).map((m) => (
            <button key={m} onClick={() => onMode(m)}
              className={"h-6 rounded-md px-2.5 transition-colors " + (mode === m ? "text-text-primary" : "text-text-muted hover:text-text-primary")}
              style={mode === m ? { background: "var(--accent-soft)" } : undefined}>
              {m === "both" ? "Names and contents" : "Names only"}
            </button>
          ))}
        </div>
        <span className="text-text-muted">Files ignored by .gitignore are left out.</span>
        <span className="ml-auto text-text-muted">
          {busy ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Searching {baseName(cwd)}…</span>
            : `${names!.length}${names!.length === NAMES_MAX ? "+" : ""} names · ${files.size} files with matches · ${(took / 1000).toFixed(1)} s`}
        </span>
      </div>
      {root ? (
        <p className="p-4 text-[12.5px] text-text-muted">A whole drive takes too long to search, and the search cannot be stopped once it starts. Open a folder on it, then search.</p>
      ) : error ? (
        <p className="p-4 text-[12.5px] text-red-400">{error}</p>
      ) : (
        <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
          {names && names.length > 0 && (
            <div className="flex flex-col">
              <span className="pb-1 text-[11px] font-medium text-text-muted">Names</span>
              {names.map((p) => (
                <button key={p} onClick={() => onOpenPath(p)} className="flex h-7 items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-text-secondary hover:bg-white/5 hover:text-text-primary">
                  <FileIcon icon={theme.file(baseName(p))} size={14} />
                  <span className="truncate">{baseName(p)}</span>
                  <span className="truncate text-[11.5px] text-text-muted">{at(p)}</span>
                </button>
              ))}
            </div>
          )}
          {files.size > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium text-text-muted">Contents</span>
              {[...files].map(([path, list]) => (
                <div key={path} className="flex flex-col gap-0.5 rounded-lg border border-subtle bg-elev px-2.5 py-2">
                  <button onClick={() => onOpenLine(path, list[0].line)} className="flex items-center gap-2 text-left text-[12.5px] text-text-primary hover:underline">
                    <FileIcon icon={theme.file(baseName(path))} size={14} />{baseName(path)}
                    <span className="text-[11.5px] text-text-muted">{at(path)} · {list.length} {list.length === 1 ? "match" : "matches"}</span>
                  </button>
                  {list.slice(0, LINES_PER_FILE).map((h) => (
                    <button key={h.line} onClick={() => onOpenLine(path, h.line)}
                      className="truncate rounded px-1 text-left font-mono text-[12px] text-text-secondary hover:bg-white/5">
                      <span className="mr-2 text-text-muted">{h.line}</span>{h.text.trim()}
                    </button>
                  ))}
                  {list.length > LINES_PER_FILE && <span className="px-1 text-[11.5px] text-text-muted">{list.length - LINES_PER_FILE} more in this file</span>}
                </div>
              ))}
            </div>
          )}
          {!busy && names!.length === 0 && files.size === 0 && <p className="text-[12.5px] text-text-muted">Nothing in {baseName(cwd)} matches “{query}”.</p>}
        </div>
      )}
    </div>
  );
}
