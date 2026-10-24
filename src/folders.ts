// What a folder holds, kept fresh while it is on screen.
//
// Deck's file watcher (watchFiles) is one set the Editor owns, and setting it from here would
// replace the Editor's, so the open folder is listed again every few seconds instead: only while
// something shows it and the window is not hidden (Deck's rule 11), and a listing that has not
// changed changes nothing (rule 9). After the explorer's own changes it is re-read at once.
import { useEffect, useSyncExternalStore } from "react";
import { fsList, shellList, shellParents, type ShellPlace } from "../shim/bridge.js";
import { baseName, isAdb, isDevice, type Entry } from "./logic";
import { adbList } from "./adb";

/** A phone folder's name, by its path: its parts are ids (logic.ts), so names are kept as they are read. */
const names = new Map<string, string>();
export const nameOf = (p: string) => names.get(p) ?? baseName(p);
export const nameIt = (p: string, name: string) => { names.set(p, name); };
/** The folders from a phone down to `p`, named; each name kept for nameOf. */
export async function phoneCrumbs(p: string): Promise<ShellPlace[]> {
  const list = await shellParents(p);
  for (const c of list) names.set(c.path, c.name);
  return list;
}

export interface Listing { entries: Entry[]; error: string; loading: boolean }
const EMPTY: Listing = { entries: [], error: "", loading: true };
const listings = new Map<string, Listing>();
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

const same = (a: Entry[], b: Entry[]) => a.length === b.length
  && a.every((x, i) => x.path === b[i].path && x.mtimeMs === b[i].mtimeMs && x.size === b[i].size && x.hidden === b[i].hidden);

/** List `dir` now. The build folders (node_modules and the rest) are included: this is a file manager. */
export async function relist(dir: string): Promise<void> {
  try {
    const entries = (isAdb(dir) ? await adbList(dir) : isDevice(dir) ? await shellList(dir) : await fsList(dir, true)) as Entry[];
    if (isDevice(dir)) for (const e of entries) names.set(e.path, e.name);
    const was = listings.get(dir);
    if (was && !was.error && !was.loading && same(was.entries, entries)) return;
    listings.set(dir, { entries, error: "", loading: false });
  } catch (e) {
    const was = listings.get(dir);
    const error = String(e);
    if (was?.error === error) return;
    listings.set(dir, { entries: [], error, loading: false });
  }
  notify();
}

/** The listing of `dir`, read on first use and every 3s while mounted and the window is shown. */
export function useListing(dir: string): Listing {
  const l = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => listings.get(dir) ?? EMPTY);
  useEffect(() => {
    if (!dir) return;
    void relist(dir);
    // A phone answers slowly and one request at a time: listed once, and again on Refresh.
    if (isDevice(dir) || isAdb(dir)) return;
    const tick = () => { if (!document.hidden) void relist(dir); };
    const t = setInterval(tick, 3000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [dir]);
  return l;
}

/** Forget every listing: the plugin is being reloaded. */
export function clearListings() { listings.clear(); }
