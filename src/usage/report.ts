// A disk-usage report as the plugin holds it: Deck measures a folder's top-level folders one call at a
// time (fsUsage), and each answer is added here, with the folder's own loose files, into one report.
// Pure: no React, no IO, so usage.check.mjs runs it as it is.
import type { FsUsage, UsageFile, UsageNode } from "../../shim/bridge.js";
import { baseName, joinPath } from "../logic";

/** The age buckets' upper edges in days, and the bucket names: the last bucket is everything older. */
export const AGE_DAYS = [30, 182, 365, 730, 1825];
export const AGE_LABELS = ["Under a month", "1–6 months", "6–12 months", "1–2 years", "2–5 years", "Over 5 years"];
/** The smallest folder the tree lists and the smallest file kept by name: 1 MB. */
export const MIN_BYTES = 1 << 20;
/** How many large files a report keeps, for Largest files and Duplicates. */
export const MAX_FILES = 5000;

export interface TypeSum { ext: string; size: number; count: number }
export interface Report {
  root: string;
  tree: UsageNode;
  big: UsageFile[];
  types: TypeSum[];
  ages: [number, number][];
  skipped: number;
  dirs: number;
}

export { joinPath, baseName as nameOf };

export function emptyReport(root: string): Report {
  return { root, tree: { name: baseName(root), size: 0, files: 0, newest: 0, children: [] }, big: [], types: [], ages: AGE_LABELS.map(() => [0, 0]), skipped: 0, dirs: 1 };
}

const extOf = (name: string) => { const i = name.lastIndexOf("."); return i > 0 ? name.slice(i + 1).toLowerCase() : ""; };

/** Which age bucket a file last changed at `mtime` falls in, as of `now`. */
export function ageBucket(mtime: number, now: number): number {
  const days = (now - mtime) / 86_400_000;
  const i = AGE_DAYS.findIndex((d) => days <= d);
  return i < 0 ? AGE_DAYS.length : i;
}

function mergeTypes(a: TypeSum[], b: TypeSum[]): TypeSum[] {
  const m = new Map(a.map((t) => [t.ext, { ...t }]));
  for (const t of b) { const x = m.get(t.ext); if (x) { x.size += t.size; x.count += t.count; } else m.set(t.ext, { ...t }); }
  return [...m.values()].sort((x, y) => y.size - x.size);
}

const topFiles = (a: UsageFile[], b: UsageFile[]) => [...a, ...b].sort((x, y) => y.size - x.size).slice(0, MAX_FILES);

/** The report with one more top-level folder's measurement in it. */
export function addFolder(r: Report, part: FsUsage): Report {
  const t = part.tree;
  const children = t.size >= MIN_BYTES ? [...r.tree.children, t].sort((x, y) => y.size - x.size) : r.tree.children;
  return {
    ...r,
    tree: { ...r.tree, size: r.tree.size + t.size, files: r.tree.files + t.files, newest: Math.max(r.tree.newest, t.newest), children },
    big: topFiles(r.big, part.big),
    types: mergeTypes(r.types, part.types),
    ages: r.ages.map(([s, c], i) => [s + (part.ages[i]?.[0] ?? 0), c + (part.ages[i]?.[1] ?? 0)]),
    skipped: r.skipped + part.skipped,
    dirs: r.dirs + part.dirs,
  };
}

/** The report with the root's own files in it (the ones directly in it, from its listing). */
export function addLooseFiles(r: Report, files: { path: string; name: string; size: number; mtimeMs: number }[], now: number): Report {
  if (!files.length) return r;
  const ages = r.ages.map(([s, c]) => [s, c] as [number, number]);
  const types: TypeSum[] = [];
  let size = 0, newest = r.tree.newest;
  for (const f of files) {
    size += f.size;
    newest = Math.max(newest, f.mtimeMs);
    const b = ageBucket(f.mtimeMs, now);
    ages[b][0] += f.size; ages[b][1] += 1;
    types.push({ ext: extOf(f.name), size: f.size, count: 1 });
  }
  const big = files.filter((f) => f.size >= MIN_BYTES).map((f) => ({ path: f.path, size: f.size, mtime: f.mtimeMs }));
  return {
    ...r,
    tree: { ...r.tree, size: r.tree.size + size, files: r.tree.files + files.length, newest },
    big: topFiles(r.big, big), types: mergeTypes(r.types, types), ages,
  };
}

/** A folder in the report by its path from the root's tree (names below the root), or null. */
export function nodeAt(tree: UsageNode, names: string[]): UsageNode | null {
  let n: UsageNode | undefined = tree;
  for (const name of names) { n = n.children.find((c) => c.name === name); if (!n) return null; }
  return n;
}

/** What a folder's listed children leave over: its own files and the folders too small to list. */
export const restOf = (n: UsageNode) => Math.max(0, n.size - n.children.reduce((s, c) => s + c.size, 0));

/** Each kind of file a type falls under, for its colour and the Types tab's bar. */
export const KINDS: { name: string; color: string; exts: string[] }[] = [
  { name: "Video", color: "#ec4899", exts: ["mp4", "mkv", "mov", "avi", "wmv", "webm", "m4v", "mts"] },
  { name: "Pictures", color: "#f472b6", exts: ["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "tif", "tiff", "raw", "cr2", "nef", "dng", "psd", "svg"] },
  { name: "Audio", color: "#c084fc", exts: ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus"] },
  { name: "Archives", color: "#a855f7", exts: ["zip", "7z", "rar", "tar", "gz", "tgz", "xz", "bz2", "zst", "cab"] },
  { name: "Disk images", color: "#2dd4bf", exts: ["iso", "img", "vhd", "vhdx", "vmdk", "vdi", "qcow2", "wim", "esd"] },
  { name: "Programs", color: "#4f8cff", exts: ["exe", "dll", "msi", "sys", "so", "dylib", "appx", "msix", "apk", "aab", "pak", "bundle"] },
  { name: "Build output", color: "#f59e0b", exts: ["rlib", "rmeta", "pdb", "o", "obj", "lib", "a", "class", "jar", "dill", "incr", "pch", "ilk"] },
  { name: "Documents", color: "#38bdf8", exts: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "epub"] },
  { name: "Code", color: "#34d399", exts: ["ts", "tsx", "js", "jsx", "mjs", "dart", "rs", "py", "go", "java", "kt", "c", "cpp", "h", "cs", "php", "rb", "swift", "json", "yaml", "yml", "toml", "html", "css"] },
];
export const OTHER_KIND = { name: "Other", color: "#64748b", exts: [] as string[] };
const kindByExt = new Map(KINDS.flatMap((k) => k.exts.map((e) => [e, k] as const)));
export const kindOf = (ext: string) => kindByExt.get(ext) ?? OTHER_KIND;

/** The space by kind, largest first. */
export function byKind(types: TypeSum[]): { name: string; color: string; size: number; count: number }[] {
  const m = new Map<string, { name: string; color: string; size: number; count: number }>();
  for (const t of types) {
    const k = kindOf(t.ext);
    const x = m.get(k.name) ?? { name: k.name, color: k.color, size: 0, count: 0 };
    x.size += t.size; x.count += t.count; m.set(k.name, x);
  }
  return [...m.values()].sort((a, b) => b.size - a.size);
}

/** "today", "3 days ago", "2 months ago", "1 year ago": when something last changed. */
export function agoLabel(ms: number, now: number): string {
  if (!ms) return "";
  const days = Math.floor((now - ms) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 31) return `${days} days ago`;
  const months = Math.floor(days / 30.4);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365.25);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** The report as CSV: every listed folder with its path, size, files and last change. */
export function toCsv(r: Report): string {
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = ["Path,Size (bytes),Files,Last change"];
  const walk = (n: UsageNode, path: string) => {
    rows.push([q(path), n.size, n.files, n.newest ? new Date(n.newest).toISOString() : ""].join(","));
    for (const c of n.children) walk(c, joinPath(path, c.name));
  };
  walk(r.tree, r.root);
  return rows.join("\r\n") + "\r\n";
}
