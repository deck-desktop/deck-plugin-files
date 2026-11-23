// The disk-usage report, opened over a Files tab by Analyze sizes: the folder's total and how the scan
// went, Rescan, Stop and Export, and the six views of it as tabs. The scan itself is scan.ts's and
// outlives this view.
import { useEffect, useState } from "react";
import { ArrowLeft, PieChart, RefreshCw, ShieldCheck } from "lucide-react";
import { fsDrives, fsOpen, fsReveal, fsWrite, pickSavePath, isWindows } from "../../shim/bridge.js";
import { ConfirmDialog, ContextMenu, type ConfirmState, type MenuEntry } from "../../shim/ui.js";
import { sizeLabel, baseName, parentOf } from "../logic";
import { remove } from "../ops";
import { notice, failure } from "../notice";
import { forgetPaths, measureAsAdmin, scan, scanOf, stopScan, useScan } from "./scan";
import { nodeAt, partsBelow, toCsv } from "./report";
import { TreeTab } from "./TreeTab";
import { TreemapTab } from "./TreemapTab";
import { LargestTab } from "./LargestTab";
import { TypesTab } from "./TypesTab";
import { AgeTab } from "./AgeTab";
import { DupesTab } from "./DupesTab";

type TabId = "tree" | "treemap" | "largest" | "types" | "age" | "dupes";
const TABS: [TabId, string][] = [["tree", "Tree"], ["treemap", "Treemap"], ["largest", "Largest files"], ["types", "Types"], ["age", "Age"], ["dupes", "Duplicates"]];
const btn = "flex h-[30px] items-center gap-1.5 rounded-lg border border-subtle bg-elev px-3 text-[12.5px] text-text-secondary transition-colors hover:border-strong hover:text-text-primary";
const seconds = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

export function UsageView({ root, onClose, onOpen, onAnalyze }: {
  root: string; onClose: () => void; onOpen: (path: string) => void; onAnalyze: (path: string) => void;
}) {
  const s = useScan(root);
  const [tab, setTab] = useState<TabId>("tree");
  const [kind, setKind] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [free, setFree] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const bin = isWindows() ? "the Recycle Bin" : "the Trash";

  // A folder opened for the first time is measured; one measured before shows what was found.
  useEffect(() => { if (!scanOf(root)) void scan(root); }, [root]);
  // At a drive's root the ring shows its free space too.
  useEffect(() => {
    setFree(null);
    void fsDrives().then((ds) => { const d = ds.find((x) => x.path.replace(/[\\/]+$/, "").toLowerCase() === root.replace(/[\\/]+$/, "").toLowerCase()); if (d) setFree(d.free); },
      (e: unknown) => console.warn("[files] reading the drives failed", e));
  }, [root]);

  // Gone from the screen at once, and from the report's totals, so no rescan is needed after a delete.
  const onGone = (paths: string[]) => { setGone((g) => new Set([...g, ...paths])); forgetPaths(root, paths); };
  const trashFolder = (path: string, size: number) => setConfirm({
    title: `Move ${baseName(path)} to ${bin}?`,
    body: `${sizeLabel(size)}, with everything in it. It can be restored from ${bin}.`,
    confirmLabel: "Move", danger: true,
    onConfirm: () => void remove([path], false).then(() => { onGone([path]); notice(`${baseName(path)} moved to ${bin}`); },
      (e: unknown) => { console.warn("[files] moving a folder to the bin failed", e); failure("Moving to the bin failed", String(e).replace(/^Error: /, "")); }),
  });
  const folderMenu = (path: string, x: number, y: number) => setMenu({ x, y, items: [
    { label: "Open in Files", onClick: () => onOpen(path) },
    { label: "Analyze this folder", icon: PieChart, onClick: () => onAnalyze(path) },
    { label: isWindows() ? "Show in Windows Explorer" : "Show in the file manager", onClick: () => void fsReveal(path).catch((e: unknown) => console.warn("[files] reveal failed", e)) },
    { label: "Copy path", onClick: () => void navigator.clipboard.writeText(path).then(() => notice("Path copied")) },
    "sep",
    { label: `Move to ${bin}…`, danger: true, onClick: () => trashFolder(path, s ? nodeAt(s.report.tree, partsBelow(root, path))?.size ?? 0 : 0) },
  ] });
  const exportCsv = async () => {
    if (!s) return;
    const to = await pickSavePath(`${baseName(root).replace(/[:\\/]/g, "") || "drive"} sizes.csv`, "csv").catch(() => "");
    if (!to) return;
    await fsWrite(to, toCsv(s.report)).then(() => notice("Sizes exported"), (e: unknown) => { console.warn("[files] export failed", e); failure("Exporting failed", String(e)); });
  };

  const r = s?.report;
  const status = !s ? "" : s.state === "scanning"
    ? `${s.done} of ${s.total} folders · ${r!.tree.files.toLocaleString()} files${s.current ? ` · now in ${s.current}` : ""}`
    : s.state === "failed" ? `Could not be measured: ${s.error}`
    : `${r!.tree.files.toLocaleString()} files in ${r!.dirs.toLocaleString()} folders · ${s.state === "stopped" ? "stopped after" : "measured in"} ${seconds(s.took)}`;
  // Folders Windows keeps to itself (System Volume Information, Config.Msi) or that are in use: named
  // in the tooltip where they are known, which is when a whole top-level folder could not be read.
  const skipped = r && s?.state !== "scanning" && r.skipped > 0 ? `${r.skipped} folder${r.skipped === 1 ? "" : "s"} could not be read` : "";
  const skippedWhy = s?.unreadable.length
    ? `${s.unreadable.join("\n")}\n\nWindows lets only itself or an administrator into these, so their size is not counted.`
    : "Windows did not let Deck into these, usually system folders, so their size is not counted.";

  // Windows asks first (UAC); a "no" is the user's answer, not a failure to report.
  const [elevating, setElevating] = useState(false);
  const asAdmin = () => {
    setElevating(true);
    void measureAsAdmin(root).then((n) => { if (n) notice(`${n} more folder${n === 1 ? "" : "s"} measured`); },
      (e: unknown) => { if (!/cancelled/.test(String(e))) { console.warn("[files] measuring as administrator failed", e); failure("Measuring as administrator failed", String(e).replace(/^Error: /, "")); } })
      .finally(() => setElevating(false));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app">
      <div className="flex h-[52px] shrink-0 items-center gap-4 border-b border-subtle px-3">
        <button onClick={onClose} title="Back to the files" aria-label="Back to the files" className="grid size-8 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-white/5 hover:text-text-primary"><ArrowLeft size={16} /></button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2.5 text-[15px] font-semibold">
            <span className="truncate text-text-primary">{s?.state === "scanning" ? `Measuring ${baseName(root)}` : baseName(root)}</span>
            {r && <span style={{ color: "var(--accent)" }}>{sizeLabel(r.tree.size)}{s?.state === "scanning" ? " so far" : ""}</span>}
          </span>
          <span className="truncate text-[12px] text-text-muted" title={status}>{status}{skipped && <> · <span className="cursor-help underline decoration-dotted underline-offset-2" title={skippedWhy}>{skipped}</span></>}</span>
        </div>
        {s?.state === "scanning" ? <>
          <span className="h-1.5 w-52 overflow-hidden rounded-full bg-elev"><span className="block h-full transition-[width]" style={{ width: `${(s.done / Math.max(1, s.total)) * 100}%`, background: "var(--accent)" }} /></span>
          <button className={btn} onClick={() => stopScan(root)}>Stop</button>
        </> : <>
          {isWindows() && !!s?.unreadable.length && s.state !== "failed" && (
            <button className={btn} disabled={elevating} onClick={asAdmin} title={`Windows asks to allow it, then ${s.unreadable.length === 1 ? "this folder is" : `these ${s.unreadable.length} folders are`} measured too:\n${s.unreadable.join("\n")}`}>
              <ShieldCheck size={13} />{elevating ? "Measuring…" : "Measure as administrator"}
            </button>
          )}
          <button className={btn} onClick={() => { setGone(new Set()); void scan(root); }}><RefreshCw size={13} />Rescan</button>
          <button className={btn} disabled={!r} onClick={() => void exportCsv()}>Export CSV</button>
        </>}
      </div>
      <div className="flex h-[38px] shrink-0 items-end gap-1 border-b border-subtle px-3" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={"h-[34px] px-3.5 text-[12.5px] font-medium " + (tab === id ? "text-text-primary" : "text-text-muted hover:text-text-primary")}
            style={tab === id ? { boxShadow: "inset 0 -2px 0 var(--accent)" } : undefined}>{label}</button>
        ))}
      </div>
      {!r ? <div className="flex flex-1 items-center justify-center text-[12.5px] text-text-muted">Measuring…</div>
        : tab === "tree" ? <TreeTab report={r} free={free} gone={gone} onOpen={onOpen} onTrash={trashFolder} onMenu={folderMenu} />
        : tab === "treemap" ? <TreemapTab report={r} gone={gone} onMenu={folderMenu} onFileMenu={fileMenu} />
        : tab === "largest" ? <LargestTab report={r} gone={gone} onGone={onGone} kind={kind} setKind={setKind} onOpenFolder={onOpen} />
        : tab === "types" ? <TypesTab report={r} onPick={(ext) => { setKind(ext); setTab("largest"); }} />
        : tab === "age" ? <AgeTab report={r} gone={gone} onGone={onGone} onOpenFolder={onOpen} />
        : <DupesTab report={r} gone={gone} onGone={onGone} onMenu={fileMenu} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
