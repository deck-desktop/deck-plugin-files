// What the explorer remembers: its tabs (a folder each, and how it is viewed), the pinned folders
// in the sidebar, and whether hidden files show. Outside React, because Deck unmounts a tab you
// are not looking at; kept in the plugin's own config, written only when it changed (Deck's
// performance rule 3: every write wakes every config listener).
import { useSyncExternalStore } from "react";
import { configRead, configWrite, fsHomeDir } from "../shim/bridge.js";
import type { SortKey } from "./logic";

export type View = "details" | "grid";
export interface Tab { id: string; path: string; view: View; sort: SortKey; asc: boolean }
export interface Pin { path: string; name: string }
export interface State {
  tabs: Tab[];
  active: string;
  pins: Pin[];
  showHidden: boolean;
  preview: boolean;
  /** Thumbnail size in the grid, 1 (small) to 4. */
  gridSize: number;
}

const CONFIG = "files";
let state: State = { tabs: [], active: "", pins: [], showHidden: false, preview: true, gridSize: 2 };
let loaded: Promise<void> | null = null;
let written = "";
const subs = new Set<() => void>();

export const newTab = (path: string): Tab => ({ id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, path, view: "details", sort: "name", asc: true });

/** Read the saved state once; a first run starts in the home folder with its usual folders pinned. */
export function loadState(): Promise<void> {
  loaded ??= (async () => {
    const text = await configRead(CONFIG).catch(() => "");
    let saved: Partial<State> = {};
    try { saved = text.trim() ? JSON.parse(text) : {}; } catch (e) { console.warn("[files] the saved state could not be read", e); }
    written = text.trim() ? JSON.stringify({ ...state, ...saved }) : "";
    state = { ...state, ...saved };
    if (!state.tabs.length || !state.pins.length) {
      const home = await fsHomeDir().catch(() => "C:\\");
      if (!state.tabs.length) { const t = newTab(home); state = { ...state, tabs: [t], active: t.id }; }
      if (!saved.pins) state = { ...state, pins: ["Desktop", "Downloads", "Documents", "Pictures"].map((n) => ({ path: `${home}\\${n}`, name: n })) };
    }
    if (!state.tabs.some((t) => t.id === state.active)) state = { ...state, active: state.tabs[0].id };
    subs.forEach((f) => f());
  })();
  return loaded;
}

export function getState(): State { return state; }

/** Change the state; saved when it differs from what is on disk. */
export function update(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  subs.forEach((f) => f());
  const text = JSON.stringify(state);
  if (text === written) return;
  written = text;
  void configWrite(CONFIG, text).catch((e) => { written = ""; console.warn("[files] saving failed", e); });
}

/** Change one tab. */
export function updateTab(id: string, patch: Partial<Tab>) {
  update((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
}

export function useFilesState(): State {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => state);
}
