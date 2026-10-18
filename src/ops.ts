// What the explorer does to files: copy, move, the Recycle Bin, delete, rename, new. Each item is
// one of Deck's fs calls, so progress is per item: a big folder is one call, and shows as one step.
//
// A name already taken in the folder being copied into is asked about once per clash (Replace,
// Keep both, Skip; a folder only Keep both or Skip, since a copy cannot merge two folders), with
// "the same for the rest". Copying between this PC and a server is refused: each fs call works on
// one side.
import { useSyncExternalStore } from "react";
import { fsCopy, fsCreateDir, fsCreateFile, fsDelete, fsList, fsMove, fsRename, fsTrash } from "../shim/bridge.js";
import { baseName, clashes, insideItself, isRemote, joinPath, parentOf, type Clash, type Entry } from "./logic";
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

/** Into the Recycle Bin (on this PC), or deleted for good (on a server, which has none). */
export async function remove(paths: string[], forever: boolean): Promise<void> {
  for (const p of paths) await (forever || isRemote(p) ? fsDelete(p) : fsTrash(p));
  await Promise.all([...new Set(paths.map((p) => parentOf(p) ?? ""))].filter(Boolean).map(relist));
}

export async function rename(path: string, name: string): Promise<string> {
  const to = await fsRename(path, name);
  const dir = parentOf(path);
  if (dir) await relist(dir);
  return to;
}

/** A new folder or empty file in `dir`, named `name`. Returns its path. */
export async function create(dir: string, name: string, folder: boolean): Promise<string> {
  const at = await (folder ? fsCreateDir(dir, name) : fsCreateFile(dir, name));
  await relist(dir);
  return at;
}
