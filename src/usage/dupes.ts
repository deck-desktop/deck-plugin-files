// Duplicate files: only files that share a size can be the same, so those are grouped first, largest
// first, and only they are hashed. Pure; the hashing itself is DupesTab's (fsHash).
import type { UsageFile } from "../../shim/bridge.js";

/** Files that share a size with another, by size, largest first. */
export function sameSize(files: UsageFile[]): UsageFile[][] {
  const by = new Map<number, UsageFile[]>();
  for (const f of files) { const g = by.get(f.size); if (g) g.push(f); else by.set(f.size, [f]); }
  return [...by.values()].filter((g) => g.length > 1).sort((a, b) => b[0].size - a[0].size);
}

/** One group of same-size files split by content: the sets of two or more with the same hash. */
export function sameContent(group: UsageFile[], hashes: (string | null)[]): UsageFile[][] {
  const by = new Map<string, UsageFile[]>();
  group.forEach((f, i) => { const h = hashes[i]; if (!h) return; const g = by.get(h); if (g) g.push(f); else by.set(h, [f]); });
  // The newest first in each, which is the copy kept by "all but the newest".
  return [...by.values()].filter((g) => g.length > 1).map((g) => [...g].sort((a, b) => b.mtime - a.mtime));
}

/** What removing every copy but one of each set would free. */
export const freeable = (sets: UsageFile[][]) => sets.reduce((s, g) => s + g[0].size * (g.length - 1), 0);
