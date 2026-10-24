// Files: a file explorer in a Deck tab. Tabs of its own (a folder each), a toolbar (back, forward,
// up, the path, search, the view), the sidebar of places, the folder as a table or as tiles, the
// preview pane, and a status bar with what is selected and what is being copied.
//
// Opening a file goes where Deck opens that kind (Settings, Files: a .pdf in PDF, a page in the
// browser, code in the Editor), and anything Deck has nothing for opens in Windows' own app.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Check, ChevronDown, Columns2, FolderOpen, LayoutGrid, List,
  PanelRight, RefreshCw, Search as SearchIcon, X,
} from "lucide-react";
import { fsOpen, fsReveal, fsList } from "../shim/bridge.js";
import {
  ConfirmDialog, ContextMenu, NamePrompt, TabStrip, onKeys, openIn, openerFor, openersFor, toast, useResize, useScope,
  type ConfirmState, type MenuEntry, type NamePromptState,
} from "../shim/ui.js";
import { applyDtCommand, openInEditor, switchWorkspace, workspaceByCwd } from "../shim/terminals.js";
import { baseName, crumbs, groupEntries, isAdb, isDevice, isRemote, parentOf, previewKind, sizeLabel, sortEntries, typeAhead, type Clash, type Entry, type SortKey } from "./logic";
import { nameOf, phoneCrumbs, relist, useListing } from "./folders";
import { cancelJob, clipboard, create, fromPhone, paste, remove, rename, setClipboard, useClipboard, useJob, type Ask, type Choice } from "./ops";
import { Details, Grid } from "./Listing";
import { Preview } from "./Preview";
import { Search } from "./Search";
import { Sidebar } from "./Sidebar";
import { getState, loadState, newTab, update, updateTab, useFilesState, type Tab } from "./store";
import { DROP, DragBadge, TABS, setDropHost } from "./drag";

/** The edge a side pane is dragged by: a few pixels over the pane's border, lit while pointed at. */
const splitter = "relative z-10 -mx-[3px] w-[6px] shrink-0 cursor-col-resize transition-colors hover:bg-[var(--accent)]";
/** The toolbar's Sort and View: a word with an arrow, opening a menu, as Explorer's are. */
const menuButton = "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary";
const tool = "grid size-8 shrink-0 place-items-center rounded-lg text-text-muted transition-colors hover:bg-white/5 hover:text-text-primary disabled:opacity-35 disabled:hover:bg-transparent";

/** Each tab's back and forward stacks, for as long as the plugin is loaded. */
const history = new Map<string, { back: string[]; fwd: string[] }>();
const hist = (id: string) => { let h = history.get(id); if (!h) { h = { back: [], fwd: [] }; history.set(id, h); } return h; };

/** A name clash being asked about, and how the answer is handed back. */
interface Asking { clash: Clash; rest: number; resolve: (a: { choice: Choice; forRest: boolean }) => void }

export function Files() {
  const s = useFilesState();
  const [ready, setReady] = useState(false);
  useEffect(() => { void loadState().then(() => setReady(true)); }, []);
  const tab = s.tabs.find((t) => t.id === s.active) ?? s.tabs[0];
  if (!ready || !tab) return <div className="h-full bg-app" />;
  return <><Explorer key={tab.id} tab={tab} /><DragBadge /></>;
}

function Explorer({ tab }: { tab: Tab }) {
  useScope("plugin:files");
  const s = useFilesState();
  const cwd = tab.path;
  const listing = useListing(cwd);
  const job = useJob();
  const clip = useClipboard();
  // Grouped (Sort, Group by), the entries run group after group, so the keyboard, Shift-click and a
  // dragged box follow the order on screen.
  const groups = useMemo(() => {
    const sorted = sortEntries(listing.entries.filter((e) => s.showHidden || !e.hidden), tab.sort, tab.asc);
    return tab.group ? groupEntries(sorted, tab.group) : null;
  }, [listing.entries, s.showHidden, tab.sort, tab.asc, tab.group]);
  const entries = useMemo(
    () => (groups ? groups.flatMap((g) => g.entries) : sortEntries(listing.entries.filter((e) => s.showHidden || !e.hidden), tab.sort, tab.asc)),
    [groups, listing.entries, s.showHidden, tab.sort, tab.asc]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState(false);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [searchMode, setSearchMode] = useState<"both" | "names">("both");
  // A menu's rows, or a function that builds them: called on every render, so a checkbox row
  // (which leaves the menu open) shows the state it just changed.
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] | (() => MenuEntry[]) } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [prompt, setPrompt] = useState<NamePromptState | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const body = useRef<HTMLDivElement>(null);
  // The sidebar and the preview pane are dragged wider or narrower by their inner edge; the width
  // is kept for every tab once the drag ends.
  const [sideW, sideDrag, sideDragging] = useResize({ initial: s.sidebarWidth ?? 224, min: 150, max: 420, direction: "horizontal" });
  const [prevW, prevDrag, prevDragging] = useResize({ initial: s.previewWidth ?? 320, min: 220, max: 720, direction: "horizontal", invert: true });
  useEffect(() => { if (!sideDragging && sideW !== (s.sidebarWidth ?? 224)) update({ sidebarWidth: sideW }); }, [sideDragging]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!prevDragging && prevW !== (s.previewWidth ?? 320)) update({ previewWidth: prevW }); }, [prevDragging]); // eslint-disable-line react-hooks/exhaustive-deps
  // The path bar shows its end, the folder you are in, when the whole path does not fit; its start
  // fades out and the wheel scrolls back to it.
  const crumbBar = useRef<HTMLDivElement>(null);
  const [crumbsClipped, setCrumbsClipped] = useState(false);
  useLayoutEffect(() => {
    const el = crumbBar.current;
    if (!el) return;
    const fit = () => { el.scrollLeft = el.scrollWidth; setCrumbsClipped(el.scrollWidth > el.clientWidth + 1); };
    fit();
    const ro = new (el.ownerDocument.defaultView ?? window).ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cwd, editingPath]);

  // A phone's folder, over USB file transfer or an app's over adb: no search, no workspace, no
  // Explorer window, no Recycle Bin.
  const phone = isDevice(cwd) || isAdb(cwd);
  const [phonePath, setPhonePath] = useState<{ label: string; path: string }[] | null>(null);
  useEffect(() => {
    setPhonePath(null);
    if (!isDevice(cwd)) return;
    let live = true;
    void phoneCrumbs(cwd).then((list) => { if (live) setPhonePath(list.map((c) => ({ label: c.name, path: c.path }))); },
      (e: unknown) => console.warn("[files] the phone's folder names could not be read", e));
    return () => { live = false; };
  }, [cwd, phone]);
  const pathCrumbs = isDevice(cwd) ? phonePath ?? [{ label: nameOf(cwd), path: cwd }]
    : isAdb(cwd) ? crumbs(cwd).map((c) => ({ ...c, label: nameOf(c.path) })) : crumbs(cwd);

  const fail = useCallback((what: string, e: unknown) => {
    console.warn(`[files] ${what}`, e);
    toast(`${what}: ${String(e).replace(/^Error: /, "")}`, "error");
  }, []);

  // A selection names paths in this folder; going elsewhere starts empty.
  useEffect(() => { setSelected(new Set()); setFocus(null); anchor.current = null; setSearched(""); setQuery(""); }, [cwd]);
  const chosen = entries.filter((e) => selected.has(e.path));

  // ---- going places ---------------------------------------------------------------------------

  const go = (path: string, record = true) => {
    if (path === cwd) return;
    if (record) { const h = hist(tab.id); h.back.push(cwd); h.fwd = []; }
    updateTab(tab.id, { path });
  };
  const back = () => { const h = hist(tab.id); const p = h.back.pop(); if (p) { h.fwd.push(cwd); go(p, false); } };
  const forward = () => { const h = hist(tab.id); const p = h.fwd.pop(); if (p) { h.back.push(cwd); go(p, false); } };
  const up = () => { const p = parentOf(cwd); if (p) go(p); };
  const newTabAt = (path: string) => { const t = newTab(path); update((st) => ({ tabs: [...st.tabs, t], active: t.id })); };

  /** Open a file the way Deck would, or in Windows' app when Deck has nothing for its kind. */
  const openEntry = (e: Entry) => {
    if (e.dir) return go(e.path);
    // A phone's file has no path an app can open: copied to this PC first, then opened like any other.
    if (isDevice(e.path) || isAdb(e.path)) { run(`Opening ${e.name} failed`, async () => openEntry({ ...e, path: await fromPhone(e) })); return; }
    const to = openerFor(e.path);
    if (to !== "editor") { openIn(e.path, to); return; }
    const kind = previewKind(e.name);
    if (kind !== "none" || isRemote(e.path)) { openInEditor(e.path); return; }
    void fsOpen(e.path).catch((err: unknown) => fail(`Opening ${e.name} failed`, err));
  };

  const openWith = (e: Entry): MenuEntry[] => {
    if (isDevice(e.path) || isAdb(e.path)) {
      // Chosen by its name (a phone path has no extension), and opened from a copy on this PC.
      return openersFor(e.name).map((o) => ({
        label: o.label, onClick: () => run(`Opening ${e.name} failed`, async () => { const p = await fromPhone(e); if (!openIn(p, o.to)) openInEditor(p); }),
      }));
    }
    const items: MenuEntry[] = openersFor(e.path).map((o) => ({
      label: o.label, onClick: () => { if (!openIn(e.path, o.to)) openInEditor(e.path); },
    }));
    if (!isRemote(e.path)) items.push("sep", { label: "Windows' default app", onClick: () => void fsOpen(e.path).catch((err: unknown) => fail("Opening failed", err)) });
    return items;
  };

  // ---- doing things ---------------------------------------------------------------------------

  const ask: Ask = (clash, rest) => new Promise((resolve) => setAsking({ clash, rest, resolve }));
  // Files dropped from a drag go through this explorer's clash question and its messages, even when
  // the drag began in another tab of Files (drag.tsx).
  useEffect(() => {
    setDropHost({ ask, fail, toast: (t: string) => toast(t, "success") });
    return () => setDropHost(null);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (what: string, work: () => Promise<unknown>) => void work().catch((e) => fail(what, e));
  const copyPaths = (paths: string[]) => run("Copying the path failed", () => navigator.clipboard.writeText(paths.join("\r\n")).then(() => toast(paths.length === 1 ? "Path copied" : `${paths.length} paths copied`, "success")));
  const pasteHere = (into = cwd) => run("Pasting failed", async () => { const n = await paste(into, ask); if (n) toast(`${n} item${n === 1 ? "" : "s"} pasted`, "success"); });
  const trash = (list: Entry[], forever = false) => {
    if (!list.length) return;
    const remote = isRemote(list[0].path) || isDevice(list[0].path);
    const what = list.length === 1 ? list[0].name : `${list.length} items`;
    const doIt = () => run("Deleting failed", async () => {
      await remove(list.map((e) => e.path), forever);
      toast(forever || remote ? `${what} deleted` : `${what} moved to the Recycle Bin`, "success");
      setSelected(new Set());
    });
    if (forever || remote) setConfirm({
      title: `Delete ${what} for good?`,
      body: isDevice(list[0].path) ? "A phone has no Recycle Bin: this cannot be undone."
        : remote ? "A server has no Recycle Bin: this cannot be undone." : "It skips the Recycle Bin, so it cannot be undone.",
      confirmLabel: "Delete", onConfirm: doIt,
    });
    else doIt();
  };
  const newItem = (folder: boolean) => setPrompt({
    title: folder ? "New folder" : "New file", subtitle: cwd, initial: folder ? "New folder" : "New file.txt", confirmLabel: "Create",
    onSave: (name) => run("Creating failed", async () => { const p = await create(cwd, name, folder); setSelected(new Set([p])); setFocus(p); }),
  });
  const pin = (e: Entry) => update((st) => st.pins.some((p) => p.path === e.path) ? {} : { pins: [...st.pins, { path: e.path, name: e.name }] });

  const onRename = (e: Entry, name: string | null) => {
    setRenaming(null);
    if (name) run("Renaming failed", async () => { const p = await rename(e.path, name); setSelected(new Set([p])); setFocus(p); });
    body.current?.focus();
  };

  // ---- selection ------------------------------------------------------------------------------

  const pick = (e: Entry, ev: React.MouseEvent) => {
    body.current?.focus();
    if (ev.button === 2) { if (!selected.has(e.path)) { setSelected(new Set([e.path])); anchor.current = e.path; } setFocus(e.path); return; }
    if (ev.shiftKey && anchor.current) {
      const a = entries.findIndex((x) => x.path === anchor.current), b = entries.findIndex((x) => x.path === e.path);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(new Set(entries.slice(lo, hi + 1).map((x) => x.path)));
    } else if (ev.ctrlKey) {
      const next = new Set(selected);
      if (next.has(e.path)) next.delete(e.path); else next.add(e.path);
      setSelected(next); anchor.current = e.path;
    } else if (!(selected.has(e.path) && selected.size > 1)) { setSelected(new Set([e.path])); anchor.current = e.path; }
    setFocus(e.path);
  };
  const settle = (e: Entry, ev: MouseEvent) => {
    if (ev.ctrlKey || ev.shiftKey) return;
    setSelected(new Set([e.path])); anchor.current = e.path;
  };
  const focusAt = () => (focus ? entries.findIndex((x) => x.path === focus) : -1);
  const moveFocus = (by: number, extend: boolean) => {
    if (!entries.length) return;
    const at = focusAt();
    focusIndex(Math.max(0, Math.min(entries.length - 1, at < 0 ? 0 : at + by)), extend);
  };
  const focusIndex = (i: number, extend = false) => {
    const p = entries[i].path;
    setFocus(p);
    if (extend && anchor.current) {
      const a = entries.findIndex((x) => x.path === anchor.current);
      const [lo, hi] = a < i ? [a, i] : [i, a];
      setSelected(new Set(entries.slice(lo, hi + 1).map((x) => x.path)));
    } else { setSelected(new Set([p])); anchor.current = p; }
    body.current?.querySelector(`[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: "nearest" });
  };
  /** How many tiles fit across, for the grid's up and down arrows. */
  const across = () => {
    const tile = body.current?.querySelector("[role=gridcell]") as HTMLElement | null;
    const grid = tile?.parentElement;
    return tile && grid ? Math.max(1, Math.round(grid.clientWidth / (tile.offsetWidth + 8))) : 1;
  };
  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (renaming || (ev.target as HTMLElement).tagName === "INPUT") return;
    const grid = tab.view === "grid" && !searched;
    const step: Record<string, number> = { ArrowDown: grid ? across() : 1, ArrowUp: grid ? -across() : -1, ArrowRight: grid ? 1 : 0, ArrowLeft: grid ? -1 : 0, PageDown: 15, PageUp: -15, Home: -1e9, End: 1e9 };
    if (ev.key in step && step[ev.key]) { ev.preventDefault(); moveFocus(step[ev.key], ev.shiftKey); return; }
    if (ev.key === "Enter" && focus) { const e = entries.find((x) => x.path === focus); if (e) { ev.preventDefault(); openEntry(e); } return; }
    if (ev.key === "Backspace") { ev.preventDefault(); up(); return; }
    // Type to select: letters typed within a second of each other build up a name to jump to.
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey && (ev.key !== " " || typed.current.text)) {
      const now = Date.now();
      const text = (now - typed.current.at < 1000 ? typed.current.text : "") + ev.key;
      typed.current = { text, at: now };
      const i = typeAhead(entries.map((x) => x.name), focusAt(), text);
      ev.preventDefault();
      if (i >= 0) focusIndex(i);
    }
  };

  // ---- menus ----------------------------------------------------------------------------------

  const entryMenu = (e: Entry | null, ev: React.MouseEvent) => {
    ev.preventDefault();
    const list = e ? (selected.has(e.path) ? chosen : [e]) : [];
    // A server's and a phone's folders: no Recycle Bin, no Explorer window, no workspace.
    const remote = isRemote(cwd) || phone;
    const items: MenuEntry[] = e ? [
      { label: "Open", hint: "Enter", onClick: () => openEntry(e) },
      ...(e.dir ? [
        { label: "Open in a new tab", onClick: () => newTabAt(e.path) },
        // A folder already open as a workspace is switched to rather than opened twice.
        ...(phone ? [] : [workspaceByCwd(e.path)
          ? { label: "Go to its workspace", onClick: () => switchWorkspace(workspaceByCwd(e.path)!.id) }
          : { label: "Open as a workspace", onClick: () => applyDtCommand("new-workspace", { cwd: e.path }) }]),
      ] as MenuEntry[] : [{ label: "Open with", children: openWith(e) } as MenuEntry]),
      "sep",
      { label: "Copy", hint: "Ctrl+C", onClick: () => setClipboard(list.map((x) => x.path), false) },
      { label: "Cut", hint: "Ctrl+X", onClick: () => setClipboard(list.map((x) => x.path), true) },
      ...(e.dir && clipboard() ? [{ label: "Paste into this folder", onClick: () => pasteHere(e.path) } as MenuEntry] : []),
      { label: "Copy path", hint: "Ctrl+Shift+C", onClick: () => copyPaths(list.map((x) => x.path)) },
      { label: "Rename", hint: "F2", disabled: list.length !== 1, onClick: () => setRenaming(e.path) },
      ...(e.dir ? [{ label: "Pin to the sidebar", onClick: () => pin(e) } as MenuEntry] : []),
      ...(!remote ? [{ label: "Show in Windows Explorer", onClick: () => run("Showing it failed", () => fsReveal(e.path)) } as MenuEntry] : []),
      "sep",
      { label: remote ? "Delete" : "Move to the Recycle Bin", hint: "Del", danger: true, onClick: () => trash(list) },
    ] : [
      { label: "New folder", hint: "Ctrl+Shift+N", onClick: () => newItem(true) },
      { label: "New file", onClick: () => newItem(false) },
      ...(clipboard() ? [{ label: "Paste", hint: "Ctrl+V", onClick: () => pasteHere() } as MenuEntry] : []),
      "sep",
      { label: "Show hidden files", checked: getState().showHidden, onClick: () => update((st) => ({ showHidden: !st.showHidden })) },
      { label: "Refresh", hint: "F5", onClick: () => void relist(cwd) },
      { label: "Copy this folder's path", onClick: () => copyPaths([cwd]) },
      ...(!remote ? [{ label: "Open in Windows Explorer", onClick: () => run("Opening it failed", () => fsOpen(cwd)) } as MenuEntry] : []),
    ];
    setMenu({ x: ev.clientX, y: ev.clientY, items: e ? items : () => { const live = getState(); return items.map((i) => (i !== "sep" && i.checked !== undefined ? { ...i, checked: live.showHidden } : i)); } });
  };
  // Explorer's Sort and View menus, under their buttons. The one in use is ticked; a pick closes
  // the menu, as there. The two switches at the end of View stay open to be flipped. New
  // folders and files are on the right-click menu (and Ctrl+Shift+N), not a button of their own.
  const under = (ev: React.MouseEvent) => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; };
  const tick = (on: boolean) => (on ? "✓" : undefined);
  const sortMenu = (ev: React.MouseEvent) => setMenu({ ...under(ev), items: [
    ...([["name", "Name"], ["date", "Date modified"], ["type", "Type"], ["size", "Size"]] as const).map(([k, label]) => ({
      label, hint: tick(tab.sort === k), onClick: () => updateTab(tab.id, { sort: k }),
    } as MenuEntry)),
    "sep",
    { label: "Ascending", hint: tick(tab.asc), onClick: () => updateTab(tab.id, { asc: true }) },
    { label: "Descending", hint: tick(!tab.asc), onClick: () => updateTab(tab.id, { asc: false }) },
    "sep",
    { label: "Group by", children: [
      ...([["name", "Name"], ["date", "Date modified"], ["type", "Type"], ["size", "Size"]] as const).map(([k, label]) => ({
        label, hint: tick(tab.group === k), onClick: () => updateTab(tab.id, { group: k }),
      } as MenuEntry)),
      { label: "(None)", hint: tick(!tab.group), onClick: () => updateTab(tab.id, { group: undefined }) },
    ] },
  ] });
  const viewMenu = (ev: React.MouseEvent) => setMenu({ ...under(ev), items: () => {
    const live = getState();
    return [
      // Biggest first, as Explorer lists them; choosing one shows the tiles.
      ...[4, 3, 2, 1].map((n) => ({
        label: `${["", "Small", "Medium", "Large", "Extra large"][n]} icons`, icon: LayoutGrid,
        hint: tick(tab.view === "grid" && live.gridSize === n),
        onClick: () => { update({ gridSize: n }); updateTab(tab.id, { view: "grid" }); },
      } as MenuEntry)),
      { label: "Details", icon: List, hint: tick(tab.view === "details"), onClick: () => updateTab(tab.id, { view: "details" }) },
      "sep",
      { label: "Preview pane", icon: PanelRight, checked: live.preview, onClick: () => update((st) => ({ preview: !st.preview })) },
      { label: "Hidden files", checked: live.showHidden, onClick: () => update((st) => ({ showHidden: !st.showHidden })) },
    ];
  } });

  // ---- keys -----------------------------------------------------------------------------------

  // The focused element of the document the view is in: Deck's main window's, or a floating window's.
  const focused = () => body.current?.ownerDocument.activeElement ?? null;
  const inBody = () => !!body.current?.contains(focused()) && !renaming && focused()?.tagName !== "INPUT";
  const latest = useRef<Record<string, () => void>>({});
  latest.current = {
    open: () => { const e = entries.find((x) => x.path === focus); if (e) openEntry(e); },
    rename: () => { if (chosen.length === 1) setRenaming(chosen[0].path); },
    delete: () => trash(chosen),
    "delete-forever": () => trash(chosen, true),
    copy: () => setClipboard(chosen.map((e) => e.path), false),
    cut: () => setClipboard(chosen.map((e) => e.path), true),
    paste: () => pasteHere(),
    "select-all": () => setSelected(new Set(entries.map((e) => e.path))),
    "copy-path": () => copyPaths(chosen.length ? chosen.map((e) => e.path) : [cwd]),
    "new-folder": () => newItem(true),
    refresh: () => void relist(cwd),
    back, forward, up,
    search: () => ((body.current?.ownerDocument ?? document).getElementById(`files-search-${tab.id}`) as HTMLInputElement | null)?.focus(),
  };
  useEffect(() => {
    const k = (id: string, when: () => boolean = inBody) => ({ [`plugin:files:${id}`]: { when, run: () => latest.current[id]() } });
    const always = () => !!body.current?.closest("[data-files]")?.contains(focused()) || inBody();
    return onKeys({
      ...k("rename"), ...k("delete"), ...k("delete-forever"), ...k("copy"), ...k("cut"), ...k("paste"), ...k("select-all"),
      ...k("copy-path"), ...k("new-folder", always), ...k("refresh", always), ...k("back", always), ...k("forward", always),
      ...k("up", always), ...k("search", always),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- what is drawn --------------------------------------------------------------------------

  const h = hist(tab.id);
  const listProps = {
    entries, selected, focus, renaming, cut: new Set(clip?.cut ? clip.paths : []),
    sort: tab.sort, asc: tab.asc,
    onSort: (k: SortKey) => updateTab(tab.id, k === tab.sort ? { asc: !tab.asc } : { sort: k, asc: true }),
    onPick: pick, onOpen: openEntry, onMenu: entryMenu, onRename,
    onMarquee: (paths: Set<string>) => { setSelected(paths); setFocus(null); anchor.current = null; },
    cwd, onSettle: settle, groups,
    dragItems: (e: Entry) => (selected.has(e.path) ? entries.filter((x) => selected.has(x.path)) : [e]),
  };
  const chosenSize = chosen.reduce((n, e) => n + e.size, 0);

  return (
    <div data-files className="flex h-full min-h-0 flex-col bg-app text-[13px] text-text-primary"
      // The mouse's side buttons, back (3) and forward (4), as in Windows Explorer. Taken on the way
      // down too: left to the webview, they would move its own history.
      onMouseDown={(ev) => { if (ev.button === 3 || ev.button === 4) ev.preventDefault(); }}
      onMouseUp={(ev) => { if (ev.button === 3) { ev.preventDefault(); back(); } else if (ev.button === 4) { ev.preventDefault(); forward(); } }}>
      <div {...{ [TABS]: "" }} className="contents">
      <TabStrip chip
        tabs={s.tabs.map((t) => ({ id: t.id, title: nameOf(t.path), icon: <FolderOpen size={13} className="text-text-muted" /> }))}
        activeId={tab.id}
        onSelect={(id) => update({ active: id })}
        onClose={(id) => update((st) => {
          if (st.tabs.length === 1) return {};
          const i = st.tabs.findIndex((t) => t.id === id);
          const tabs = st.tabs.filter((t) => t.id !== id);
          history.delete(id);
          return { tabs, active: st.active === id ? tabs[Math.max(0, i - 1)].id : st.active };
        })}
        onReorder={(from, to) => update((st) => {
          const tabs = [...st.tabs]; const a = tabs.findIndex((t) => t.id === from), b = tabs.findIndex((t) => t.id === to);
          const [m] = tabs.splice(a, 1); tabs.splice(b, 0, m); return { tabs };
        })}
        onAdd={() => newTabAt(cwd)} addTitle="New tab here" />
      </div>

      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-subtle px-2.5">
        <button className={tool} title="Back (Alt+Left)" aria-label="Back" disabled={!h.back.length} onClick={back}><ArrowLeft size={16} /></button>
        <button className={tool} title="Forward (Alt+Right)" aria-label="Forward" disabled={!h.fwd.length} onClick={forward}><ArrowRight size={16} /></button>
        <button className={tool} title="Up (Alt+Up)" aria-label="Up" disabled={!parentOf(cwd)} onClick={up}><ArrowUp size={16} /></button>
        <button className={tool} title="Refresh (F5)" aria-label="Refresh" onClick={() => void relist(cwd)}><RefreshCw size={14} /></button>

        {editingPath ? (
          <input autoFocus defaultValue={cwd} aria-label="Folder path"
            onKeyDown={(ev) => {
              if (ev.key === "Escape") setEditingPath(false);
              if (ev.key === "Enter") {
                const to = ev.currentTarget.value.trim().replace(/^"|"$/g, "");
                setEditingPath(false);
                if (to && to !== cwd) void fsList(to).then(() => go(to), (e: unknown) => fail(`Opening ${to} failed`, e));
              }
            }}
            onBlur={() => setEditingPath(false)}
            className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--accent)] bg-elev px-2.5 text-[12.5px] text-text-primary outline-none" />
        ) : (
          <div ref={crumbBar} onClick={(ev) => { if (ev.target === ev.currentTarget) setEditingPath(true); }} title="Click to type a path"
            onWheel={(ev) => { ev.currentTarget.scrollLeft += ev.deltaY || ev.deltaX; }}
            className="flex h-8 min-w-0 flex-1 cursor-text items-center gap-0.5 overflow-hidden rounded-lg border border-subtle bg-elev px-1.5 text-[12.5px]"
            style={crumbsClipped ? { maskImage: "linear-gradient(to right, transparent, black 28px)" } : undefined}>
            {pathCrumbs.map((c, i, all) => (
              <span key={c.path} className="flex shrink-0 items-center">
                {i > 0 && <span className="px-0.5 text-text-muted">›</span>}
                <button onClick={() => go(c.path)} {...{ [DROP]: c.path }}
                  className={"rounded px-1.5 py-0.5 hover:bg-white/5 " + (i === all.length - 1 ? "text-text-primary" : "text-text-secondary hover:text-text-primary")}>
                  {c.label}
                </button>
              </span>
            ))}
            <span className="h-full min-w-6 flex-1 cursor-text" onClick={() => setEditingPath(true)} />
          </div>
        )}

        <label className="flex h-8 w-64 shrink-0 items-center gap-2 rounded-lg border border-subtle bg-elev px-2.5 text-text-muted focus-within:border-[var(--accent)]">
          <SearchIcon size={14} className="shrink-0" />
          <input id={`files-search-${tab.id}`} value={query} placeholder={phone ? "Search is not available on a phone" : `Search ${nameOf(cwd)}`} disabled={phone} aria-label="Search this folder"
            onChange={(ev) => { setQuery(ev.target.value); if (!ev.target.value) setSearched(""); }}
            onKeyDown={(ev) => { if (ev.key === "Enter") setSearched(query.trim()); if (ev.key === "Escape") { setQuery(""); setSearched(""); body.current?.focus(); } }}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text-primary outline-none placeholder:text-text-muted" />
          {query && <button aria-label="Clear the search" onClick={() => { setQuery(""); setSearched(""); }} className="text-text-muted hover:text-text-primary"><X size={13} /></button>}
        </label>

        <button className={menuButton} aria-haspopup="menu" onClick={sortMenu}><ArrowUpDown size={14} />Sort<ChevronDown size={12} className="text-text-muted" /></button>
        <button className={menuButton} aria-haspopup="menu" onClick={viewMenu}>
          {tab.view === "grid" ? <LayoutGrid size={14} /> : <List size={14} />}View<ChevronDown size={12} className="text-text-muted" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <Sidebar cwd={cwd} pins={s.pins} onOpen={(p) => go(p)} fail={fail} width={sideW} />
        <div {...sideDrag} title="Drag to resize" className={splitter} />
        <div ref={body} tabIndex={0} onKeyDown={onKeyDown} aria-label={nameOf(cwd)}
          onMouseDown={(ev) => { if ((ev.target as HTMLElement).closest("[data-path]") === null && ev.button === 0) { setSelected(new Set()); setFocus(null); } }}
          className="flex min-w-0 flex-1 flex-col outline-none">
          {searched ? (
            <Search cwd={cwd} query={searched} mode={searchMode} onMode={setSearchMode}
              onOpenPath={(p) => { const e = { name: baseName(p), path: p, dir: false, mtimeMs: 0, size: 0, hidden: false }; openEntry(e); }}
              onOpenLine={(p, line) => openInEditor(p, line)} />
          ) : listing.error ? (
            <div className="p-6 text-[12.5px]">
              <p className="text-red-400">{nameOf(cwd)} could not be opened: {listing.error.replace(/^Error: /, "")}</p>
              {parentOf(cwd) && <button onClick={up} className="mt-2 text-[var(--accent)] hover:underline">Go up a folder</button>}
            </div>
          ) : !listing.loading && entries.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[12.5px] text-text-muted"
              onContextMenu={(ev) => entryMenu(null, ev)}>
              <span>This folder is empty{!s.showHidden && listing.entries.length ? ", apart from hidden files" : ""}.</span>
              {clip && <button onClick={() => pasteHere()} className="text-[var(--accent)] hover:underline">Paste {clip.paths.length} item{clip.paths.length === 1 ? "" : "s"} here</button>}
            </div>
          ) : tab.view === "grid" ? <Grid {...listProps} size={s.gridSize} /> : <Details {...listProps} />}

          <div className="flex h-8 shrink-0 items-center gap-4 border-t border-subtle px-4 text-[12px] text-text-muted">
            <span>{entries.length} item{entries.length === 1 ? "" : "s"}</span>
            {chosen.length > 0 && <span className="text-text-secondary">{chosen.length} selected{chosenSize ? ` · ${sizeLabel(chosenSize)}` : ""}</span>}
            {clip && <span className="flex items-center gap-1"><Columns2 size={12} />{clip.paths.length} {clip.cut ? "cut" : "copied"}, ready to paste</span>}
            {job && (
              <span className="ml-auto flex min-w-0 items-center gap-2 text-text-secondary">
                <span className="truncate">{job.label}: {job.current}</span>
                <span className="h-1 w-28 shrink-0 overflow-hidden rounded-full bg-elev">
                  <span className="block h-1 rounded-full" style={{ width: `${Math.round((job.done / Math.max(1, job.total)) * 100)}%`, background: "var(--accent)" }} />
                </span>
                <span className="shrink-0">{job.done} of {job.total}</span>
                <button onClick={cancelJob} className="shrink-0 text-[var(--accent)] hover:underline">Cancel</button>
              </span>
            )}
          </div>
        </div>
        {s.preview && !searched && (<>
          <div {...prevDrag} title="Drag to resize" className={splitter} />
          <Preview selected={chosen} cwd={cwd} onOpen={openEntry} width={prevW}
            openWithMenu={(e, x, y) => setMenu({ x, y, items: openWith(e) })}
            onCopyPath={copyPaths} onReveal={(p) => run("Showing it failed", () => fsReveal(p))} />
        </>)}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={typeof menu.items === "function" ? menu.items() : menu.items} onClose={() => setMenu(null)} />}
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      <NamePrompt state={prompt} onClose={() => setPrompt(null)} />
      {asking && <ClashDialog a={asking} onDone={(ans) => { asking.resolve(ans); setAsking(null); }} />}
    </div>
  );
}

/** A name already in the folder: what to do with it, and maybe with the rest. */
function ClashDialog({ a, onDone }: { a: Asking; onDone: (ans: { choice: Choice; forRest: boolean }) => void }) {
  const [forRest, setForRest] = useState(false);
  const btn = "h-8 rounded-lg border border-subtle bg-elev px-3 text-[12.5px] text-text-secondary transition-colors hover:border-strong hover:text-text-primary";
  const pick = (choice: Choice) => onDone({ choice, forRest });
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50" onKeyDown={(e) => { if (e.key === "Escape") pick("skip"); }}>
      <div role="dialog" aria-label="A file with this name is already here" className="flex w-[460px] flex-col gap-4 rounded-2xl border border-subtle bg-card p-5 shadow-2xl">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold text-text-primary">{a.clash.name} is already there</span>
          <span className="text-[12.5px] text-text-secondary">
            {a.clash.folder ? "A folder cannot be replaced by a copy, only kept beside it with a new name, or skipped." : "Replace it (the old one goes to the Recycle Bin), keep both, or skip this one."}
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
