// The scans, held at module level and keyed by folder: a report is opened over the Files tab, and a
// tab that is not in view is not mounted, so a scan that takes a minute must outlive it.
//
// A folder is measured one top-level folder at a time (Deck's fsUsage), largest-looking last: each
// answer is added to the report at once, which is the progress shown, and Stop takes effect between
// two of them.
import { useSyncExternalStore } from "react";
import { fsList, fsUsage, fsUsageAdmin } from "../../shim/bridge.js";
import { AGE_DAYS, MAX_FILES, MIN_BYTES, addFolder, addLooseFiles, emptyReport, type Report } from "./report";

export interface Scan {
  report: Report;
  state: "scanning" | "done" | "stopped" | "failed";
  /** Top-level folders measured, of how many. */
  done: number;
  total: number;
  /** The folder being measured now. */
  current: string;
  started: number;
  took: number;
  error?: string;
  /** The top-level folders that could not be read at all, by path (deeper ones are only counted). */
  unreadable: string[];
}

const scans = new Map<string, Scan>();
const stops = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
const emit = () => { version++; subs.forEach((f) => f()); };
const set = (root: string, s: Scan) => { scans.set(root, s); emit(); };

/** Start measuring `root`, or start again: whatever was measured before is replaced. */
export async function scan(root: string) {
  stops.delete(root);
  const started = Date.now();
  let s: Scan = { report: emptyReport(root), state: "scanning", done: 0, total: 0, current: "", started, took: 0, unreadable: [] };
  set(root, s);
  try {
    const entries = await fsList(root, true);
    const dirs = entries.filter((e) => e.dir), files = entries.filter((e) => !e.dir);
    s = { ...s, report: addLooseFiles(s.report, files, Date.now()), total: dirs.length };
    set(root, s);
    for (const d of dirs) {
      if (stops.has(root)) { set(root, { ...s, state: "stopped", current: "", took: Date.now() - started }); return; }
      s = { ...s, current: d.path };
      set(root, s);
      try {
        const part = await fsUsage(d.path, MIN_BYTES, MIN_BYTES, MAX_FILES, AGE_DAYS);
        s = { ...s, report: addFolder(s.report, part), done: s.done + 1 };
      } catch (e) {
        // One folder that cannot be read (in use, no access) is counted and the rest go on.
        console.warn(`[files] measuring ${d.path} failed`, e);
        s = { ...s, report: { ...s.report, skipped: s.report.skipped + 1 }, done: s.done + 1, unreadable: [...s.unreadable, d.path] };
      }
      set(root, s);
    }
    set(root, { ...s, state: "done", current: "", took: Date.now() - started });
  } catch (e) {
    console.warn(`[files] measuring ${root} failed`, e);
    set(root, { ...s, state: "failed", current: "", error: String(e).replace(/^Error: /, ""), took: Date.now() - started });
  }
}

/**
 * Measure the folders that could not be read as administrator (Windows asks first) and add them to
 * the report. Resolves to how many were measured; rejects with "cancelled" if the user said no.
 */
export async function measureAsAdmin(root: string): Promise<number> {
  const s0 = scans.get(root);
  if (!s0?.unreadable.length || s0.state === "scanning") return 0;
  const answers = await fsUsageAdmin(s0.unreadable, MIN_BYTES, MIN_BYTES, MAX_FILES, AGE_DAYS);
  // The report may have moved on meanwhile (a rescan): add to the one there is now, if it is the same.
  const s = scans.get(root);
  if (!s || s.started !== s0.started) return 0;
  let report = s.report, measured = 0;
  const still: string[] = [];
  answers.forEach((a, i) => {
    if ("ok" in a) { report = addFolder({ ...report, skipped: report.skipped - 1 }, a.ok); measured++; }
    else { console.warn(`[files] measuring ${s0.unreadable[i]} as administrator failed: ${a.err}`); still.push(s0.unreadable[i]); }
  });
  set(root, { ...s, report, unreadable: still });
  return measured;
}

/** Stop after the folder being measured now; what was measured stays. */
export const stopScan = (root: string) => { stops.add(root); };
export const scanOf = (root: string) => scans.get(root) ?? null;

/** The scan of `root`, kept current. */
export function useScan(root: string): Scan | null {
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version);
  return scans.get(root) ?? null;
}

/** Every scan stops: the plugin is being reloaded or switched off. */
export function disposeScans() { for (const root of scans.keys()) stops.add(root); }
