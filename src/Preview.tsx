// The preview pane: the selected file shown without opening it (a picture, a video or song, text
// and code, a PDF's first page), what it is, and how to open it. Several selected: how many and
// how big together. Nothing selected: the folder itself.
import { useEffect, useState } from "react";
import { convertFileSrc, fsRead, mediaMeta } from "../shim/bridge.js";
import { FileIcon, MediaViewer, MonacoViewer, themeById, useEditorSettings } from "../shim/ui.js";
import { extOf, isAdb, isDevice, isRemote, offPc, parentOf, previewKind, sizeLabel, typeLabel, type Entry } from "./logic";
import { nameOf } from "./folders";
import { adbRead } from "./adb";
import { useThumb } from "./thumbs";

/** Text larger than this is not read for the preview. */
const TEXT_MAX = 512 * 1024;
const LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", json: "json",
  md: "markdown", rs: "rust", py: "python", html: "html", htm: "html", css: "css", scss: "scss", yaml: "yaml", yml: "yaml",
  xml: "xml", sql: "sql", sh: "shell", ps1: "powershell", dart: "dart", go: "go", java: "java", kt: "kotlin", cs: "csharp",
  cpp: "cpp", c: "c", h: "c", toml: "ini", ini: "ini", bat: "bat", cmd: "bat",
};

// One formatter for every row. toLocaleString with options builds a new one on each call, which over
// a 5,000-file folder was most of a second per render.
const dateTime = new Intl.DateTimeFormat([], { dateStyle: "short", timeStyle: "short" });
export const when = (ms: number) => (ms ? dateTime.format(ms) : "");

function Shown({ e }: { e: Entry }) {
  const kind = previewKind(e.name);
  const phone = isDevice(e.path);
  const local = !isRemote(e.path) && !phone;
  const [text, setText] = useState<string | null>(null);
  const thumb = useThumb(e.path, e.mtimeMs, 512, (local && (kind === "pdf" || kind === "photo")) || (phone && kind !== "text" && kind !== "none"));
  useEffect(() => {
    setText(null);
    // An app's file over adb is read too: its shared_prefs XML and JSON are what it is opened for.
    if (kind !== "text" || e.size > TEXT_MAX || !(local || isAdb(e.path))) return;
    let live = true;
    void (isAdb(e.path) ? adbRead(e.path) : fsRead(e.path)).then((t: string) => { if (live) setText(t); }, () => { if (live) setText(""); });
    return () => { live = false; };
  }, [e.path, e.mtimeMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const box = "flex h-56 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-subtle bg-elev";
  if (kind === "image" && local) return <div className={box}><img src={convertFileSrc(e.path)} alt={e.name} className="max-h-full max-w-full object-contain" /></div>;
  if (kind === "media" && local) return <div className={box + " [&>*]:max-h-full"}><MediaViewer path={e.path} /></div>;
  if ((kind === "pdf" || kind === "photo" || phone) && thumb) return <div className={box}><img src={thumb} alt={e.name} className="max-h-full max-w-full object-contain" /></div>;
  if (kind === "text" && e.size <= TEXT_MAX && text !== null)
    return <div className="h-72 shrink-0 overflow-hidden rounded-xl border border-subtle"><MonacoViewer content={text} language={LANG[extOf(e.name)] ?? "plaintext"} /></div>;
  return <Big e={e} />;
}

function Big({ e }: { e: Pick<Entry, "name" | "dir"> }) {
  const theme = themeById(useEditorSettings().iconTheme);
  return (
    <div className="flex h-40 shrink-0 items-center justify-center rounded-xl border border-subtle bg-elev">
      <FileIcon icon={e.dir ? theme.folder(e.name, false) : theme.file(e.name)} size={56} />
    </div>
  );
}

export function Preview({ selected, cwd, onOpen, openWithMenu, onCopyPath, onReveal, width }: {
  selected: Entry[]; cwd: string; width: number;
  onOpen: (e: Entry) => void;
  openWithMenu: (e: Entry, x: number, y: number) => void;
  onCopyPath: (paths: string[]) => void;
  onReveal: (path: string) => void;
}) {
  const one = selected.length === 1 ? selected[0] : null;
  const [dims, setDims] = useState("");
  useEffect(() => {
    setDims("");
    if (!one || previewKind(one.name) !== "image" || isRemote(one.path)) return;
    let live = true;
    void mediaMeta([one.path]).then(([m]: { width: number | null; height: number | null }[]) => { if (live && m?.width && m.height) setDims(`${m.width} × ${m.height}`); }, () => {});
    return () => { live = false; };
  }, [one?.path, one?.mtimeMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const fact = (k: string, v: string) => v && (<><span className="text-text-muted">{k}</span><span className="break-all text-text-secondary">{v}</span></>);
  return (
    <aside aria-label="Preview" style={{ width }} className="scroll-thin flex shrink-0 flex-col gap-3 overflow-y-auto border-l border-subtle bg-panel p-4">
      {one ? <Shown key={one.path} e={one} /> : <Big e={{ name: nameOf(cwd), dir: selected.length === 0 }} />}
      <div className="flex flex-col gap-0.5">
        <span className="break-all text-[14px] font-semibold text-text-primary">{one ? one.name : selected.length ? `${selected.length} items` : nameOf(cwd)}</span>
        <span className="text-[12px] text-text-muted">
          {one ? [typeLabel(one), dims].filter(Boolean).join(" · ")
            : selected.length ? `${sizeLabel(selected.reduce((n, e) => n + e.size, 0))} in the files selected` : "Folder"}
        </span>
      </div>
      {one && (
        <div className="grid grid-cols-[84px_1fr] gap-y-1.5 text-[12px]">
          {!one.dir && fact("Size", sizeLabel(one.size))}
          {fact("Modified", when(one.mtimeMs))}
          {/* A phone's folder by its name: its path is ids. */}
              {fact("Where", isDevice(one.path) || isAdb(one.path) ? nameOf(parentOf(one.path) ?? "") : one.path.slice(0, one.path.length - one.name.length).replace(/[\\/]$/, ""))}
        </div>
      )}
      {one && (
        <div className="flex gap-2">
          <button onClick={() => onOpen(one)}
            className="h-8 flex-1 rounded-lg text-[12.5px] font-medium text-white transition hover:brightness-110" style={{ background: "var(--accent)" }}>
            Open
          </button>
          {!one.dir && (
            <button onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); openWithMenu(one, r.left, r.bottom + 4); }}
              className="h-8 flex-1 rounded-lg border border-subtle bg-elev text-[12.5px] text-text-secondary transition-colors hover:border-strong hover:text-text-primary">
              Open with ▾
            </button>
          )}
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
          <button onClick={() => onCopyPath(selected.map((e) => e.path))} className="text-[var(--accent)] hover:underline">Copy path</button>
          {one && !offPc(one.path) && <button onClick={() => onReveal(one.path)} className="text-[var(--accent)] hover:underline">Show in Windows Explorer</button>}
        </div>
      )}
    </aside>
  );
}
