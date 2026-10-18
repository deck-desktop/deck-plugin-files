// What a folder holds, kept fresh while it is on screen.
//
// Deck's file watcher (watchFiles) is one set the Editor owns, and setting it from here would
// replace the Editor's, so the open folder is listed again every few seconds instead: only while
// something shows it and the window is not hidden (Deck's rule 11), and a listing that has not
// changed changes nothing (rule 9). After the explorer's own changes it is re-read at once.
import { useEffect, useSyncExternalStore } from "react";
import { fsList } from "../shim/bridge.js";
import type { Entry } from "./logic";

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
    const entries = (await fsList(dir, true)) as Entry[];
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
    const tick = () => { if (!document.hidden) void relist(dir); };
    const t = setInterval(tick, 3000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [dir]);
  return l;
}

/** Forget every listing: the plugin is being reloaded. */
export function clearListings() { listings.clear(); }
