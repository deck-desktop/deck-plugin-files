// What the explorer does to files: copy, move, the Recycle Bin, delete, rename, new.
//
// A copy or move on this PC, or to, from or within a phone, is Windows' own (Deck's shellTransfer):
// a long one shows Windows' progress, with the time left, pause and cancel, and a name already
// there is asked about in Windows' question, as in Explorer. A server's folders are Deck's fs calls,
// one per item, so progress there is per item; a name already taken is asked about once per clash
// (Replace, Keep both, Skip; a folder only Keep both or Skip, since a copy cannot merge two
// folders), with "the same for the rest". Copying between this PC and a server is refused: each fs
// call works on one side.
import { useSyncExternalStore } from "react";
import { dataDir, fsCopy, fsCreateDir, fsCreateFile, fsDelete, fsList, fsMove, fsRename, fsTrash, shellDelete, shellNewFolder, shellRename, shellTransfer } from "../shim/bridge.js";
import { baseName, clashes, insideItself, isAdb, isDevice, isRemote, joinPath, keptName, offPc, parentOf, type Clash, type Entry } from "./logic";
import { adbCreate, adbDelete, adbList, adbPull, adbPush, adbRename } from "./adb";
import { relist } from "./folders";

// ---- the clipboard -----------------------------------------------------------------------------

/** Paths copied or cut (Ctrl+C, Ctrl+X), for a paste. The explorer's own: Windows' clipboard holds text. */
let clip: { paths: string[]; cut: boolean } | null = null;
export const setClipboard = (paths: string[], cut: boolean) => { clip = paths.length ? { paths, cut } : null; notify(); };
export const clipboard = () => clip;

// ---- what is running ---------------------------------------------------------------------------

export interface Job { label: string; done: number; total: number; current: string; cancelled: boolean }
let job: Job | null = null;
const subs = new Set<() => void>();
function notify() { subs.forEach((f) => f()); }
export const useJob = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => job);
export const useClipboard = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => clip);
export function cancelJob() { if (job) { job = { ...job, cancelled: true }; notify(); } }

/** How a clash is settled. */
export type Choice = "replace" | "both" | "skip";
/** Asks what to do with one clash; `rest` is how many more there are, for "the same for the rest". */
export type Ask = (c: Clash, rest: number) => Promise<{ choice: Choice; forRest: boolean }>;

/**
 * Copy or move `sources` into `dest`. Returns how many were done. The folders on both sides are
 * listed again afterwards, so what changed shows at once.
 */
export async function transfer(sources: Entry[] | { path: string; dir: boolean }[], dest: string, move: boolean, ask: Ask): Promise<number> {
  if (job) throw new Error("Another copy is still running.");
  const items = [...sources];
  if (items.some((s) => insideItself(s.path, dest))) throw new Error("A folder cannot be copied or moved into itself.");
  // An app's files over adb: copied to this PC only, so far. Unpacked into a folder of this
  // plugin's first, then moved into place by Windows' copy, which asks about a name already there.
  if (isAdb(dest)) return intoApp(items, dest, move, ask);
  if (items.some((s) => isAdb(s.path))) {
    if (offPc(dest)) throw new Error("An app's files can be copied to this PC only.");
    if (move) throw new Error("An app's files can be copied, not moved: deleting them comes later.");
    job = { label: `Copying ${items.length} item${items.length === 1 ? "" : "s"} from the phone`, done: 0, total: items.length, current: "", cancelled: false };
    notify();
    try {
      const staging = joinPath(await dataDir(), `from-adb-${Date.now().toString(36)}`);
      await fsCreateDir(await dataDir(), baseName(staging));
      try {
        await adbPull(items.map((s) => s.path), staging);
        const pulled = items.map((s) => ({ path: joinPath(staging, baseName(s.path)), dir: s.dir }));
        job = null;
        return (await shellTransfer(pulled.map((s) => s.path), dest, true)) ? items.length : 0;
      } finally {
        await fsDelete(staging).catch(() => { /* moved out already */ });
      }
    } finally {
      job = null;
      notify();
      await relist(dest);
    }
  }
  const server = isRemote(dest) || items.some((s) => isRemote(s.path));
  if (server && (isDevice(dest) || items.some((s) => isDevice(s.path)))) throw new Error("Copying between a server and a phone is not possible here.");
  // On this PC, or to, from or within a phone: Windows' own copy, so none of the steps below.
  if (!server) {
    const todo = move ? items.filter((s) => !samePlace(s.path, dest)) : items;
    if (!todo.length) return 0;
    job = { label: `${move ? "Moving" : "Copying"} ${todo.length} item${todo.length === 1 ? "" : "s"}`, done: 0, total: todo.length, current: "", cancelled: false };
    notify();
    try {
      return (await shellTransfer(todo.map((s) => s.path), dest, move)) ? todo.length : 0;
    } finally {
      job = null;
      notify();
      await Promise.all([...new Set([dest, ...todo.map((s) => parentOf(s.path) ?? "")])].filter(Boolean).map(relist));
    }
  }
  if (items.some((s) => isRemote(s.path) !== isRemote(dest))) throw new Error("Copying between this PC and a server is not possible here yet.");
  // Moving a file into the folder it is already in does nothing.
  const todo = move ? items.filter((s) => !samePlace(s.path, dest)) : items;
  const there = (await fsList(dest, true)) as Entry[];
  const clash = new Map(clashes(todo, there).map((c) => [c.source, c]));
  let standing: Choice | null = null, standingFolders: Choice | null = null;
  let done = 0, asked = 0;
  job = { label: `${move ? "Moving" : "Copying"} ${todo.length} item${todo.length === 1 ? "" : "s"} to ${baseName(dest)}`, done: 0, total: todo.length, current: "", cancelled: false };
  notify();
  try {
    for (const s of todo) {
      if (job?.cancelled) break;
      job = { ...job!, current: baseName(s.path) };
      notify();
      const c = clash.get(s.path);
      let choice: Choice = "both";
      if (c) {
        const kept = c.folder ? standingFolders : standing;
        if (kept) choice = kept;
        else {
          const left = [...clash.values()].length - ++asked;
          const a = await ask(c, left);
          choice = a.choice;
          if (a.forRest) { if (c.folder) standingFolders = choice; else standing = choice; }
        }
        if (c.folder && choice === "replace") choice = "both";
      }
      if (choice === "skip") { job = { ...job!, done: job!.done + 1 }; continue; }
      if (c && choice === "replace") {
        const target = joinPath(dest, c.name);
        await (isRemote(target) ? fsDelete(target) : fsTrash(target));
      }
      if (move) {
        if (isRemote(s.path) && c && choice === "both") { await fsCopy(s.path, dest); await fsDelete(s.path); }
        else await fsMove(s.path, dest, "rename");
      } else await fsCopy(s.path, dest);
      done++;
      job = { ...job!, done: job!.done + 1 };
      notify();
    }
  } finally {
    job = null;
    notify();
    await Promise.all([...new Set([dest, ...todo.map((s) => parentOf(s.path) ?? "")])].filter(Boolean).map(relist));
  }
  return done;
}
/**
 * This PC's files into an app's folder over adb. A name already there is asked about as for any
 * copy: Replace overwrites it (a folder is merged), Keep both lands a copy as `name (2)`, Skip
 * leaves it. A move puts the originals in the Recycle Bin once they are copied.
 */
async function intoApp(items: { path: string; dir: boolean }[], dest: string, move: boolean, ask: Ask): Promise<number> {
  if (items.some((s) => offPc(s.path))) throw new Error("Only files on this PC can be copied into an app's folder.");
  const there = await adbList(dest);
  const clash = new Map(clashes(items, there).map((c) => [c.source, c]));
  let standing: Choice | null = null, standingFolders: Choice | null = null;
  let asked = 0;
  const send: string[] = [], staged: string[] = [];
  const taken = there.map((e) => e.name);
  let staging = "";
  job = { label: `Copying ${items.length} item${items.length === 1 ? "" : "s"} into ${baseName(dest)}`, done: 0, total: items.length, current: "", cancelled: false };
  notify();
  try {
    for (const s of items) {
      const c = clash.get(s.path);
      let choice: Choice = "replace";
      if (c) {
        const kept = c.folder ? standingFolders : standing;
        if (kept) choice = kept;
        else {
          const a = await ask(c, clash.size - ++asked);
          choice = a.choice;
          if (a.forRest) { if (c.folder) standingFolders = choice; else standing = choice; }
        }
      }
      if (choice === "skip") continue;
      if (c && choice === "both") {
        // Staged here under the new name, so the tar carries it under that name.
        if (!staging) { staging = joinPath(await dataDir(), `to-adb-${Date.now().toString(36)}`); await fsCreateDir(await dataDir(), baseName(staging)); }
        const name = keptName(c.name, taken);
        taken.push(name);
        const copy = await fsCopy(s.path, staging);
        staged.push(await fsRename(copy, name));
      } else send.push(s.path);
    }
    await adbPush([...send, ...staged], dest);
    if (move) for (const p of send) await fsTrash(p);
    return send.length + staged.length;
  } finally {
    job = null;
    notify();
    if (staging) await fsDelete(staging).catch(() => { /* left in this plugin's folder */ });
    await Promise.all([dest, ...(move ? items.map((s) => parentOf(s.path) ?? "") : [])].filter(Boolean).map(relist));
  }
}

const samePlace = (path: string, dest: string) => {
  const p = parentOf(path);
  return !!p && p.replace(/[\\/]+$/, "").toLowerCase() === dest.replace(/[\\/]+$/, "").toLowerCase();
};

/** Paste what was copied or cut into `dest`. A cut is a move, and is used up by it. */
export async function paste(dest: string, ask: Ask): Promise<number> {
  const c = clip;
  if (!c) return 0;
  const n = await transfer(c.paths.map((path) => ({ path, dir: false })), dest, c.cut, ask);
  if (c.cut) setClipboard([], false);
  return n;
}

/**
 * A phone's file, copied into this plugin's folder to be opened (a phone's files have no path an
 * app can open). Replaces the copy made last time. Returns the copy's path.
 */
export async function fromPhone(e: { path: string; name: string }): Promise<string> {
  const base = await dataDir();
  const dir = joinPath(base, "from-phone");
  await fsCreateDir(base, "from-phone").catch(() => { /* there already */ });
  const local = joinPath(dir, e.name);
  await fsDelete(local).catch(() => { /* none yet */ });
  if (isAdb(e.path)) await adbPull([e.path], dir);
  else if (!(await shellTransfer([e.path], dir, false))) throw new Error("the copy was cancelled");
  return local;
}

/** Into the Recycle Bin (on this PC), or deleted for good (on a server, which has none). */
export async function remove(paths: string[], forever: boolean): Promise<void> {
  // A phone has no Recycle Bin: for good, and asked about first (Files.tsx).
  // An app's files over adb, and a phone's over USB: for good, and asked about first (Files.tsx).
  const app = paths.filter(isAdb);
  if (app.length) await adbDelete(app);
  const phone = paths.filter(isDevice);
  if (phone.length) await shellDelete(phone);
  for (const p of paths.filter((x) => !isDevice(x) && !isAdb(x))) await (forever || isRemote(p) ? fsDelete(p) : fsTrash(p));
  await Promise.all([...new Set(paths.map((p) => parentOf(p) ?? ""))].filter(Boolean).map(relist));
}

export async function rename(path: string, name: string): Promise<string> {
  const to = isAdb(path) ? await adbRename(path, name) : isDevice(path) ? (await shellRename(path, name), path) : await fsRename(path, name);
  const dir = parentOf(path);
  if (dir) await relist(dir);
  return to;
}

/** A new folder or empty file in `dir`, named `name`. Returns its path. */
export async function create(dir: string, name: string, folder: boolean): Promise<string> {
  if (isAdb(dir)) { const at = await adbCreate(dir, name, folder); await relist(dir); return at; }
  if (isDevice(dir) && !folder) throw new Error("A new file cannot be made on a phone: make it on this PC and copy it over.");
  const at = isDevice(dir) ? (await shellNewFolder(dir, name), "") : await (folder ? fsCreateDir(dir, name) : fsCreateFile(dir, name));
  await relist(dir);
  return at;
}
