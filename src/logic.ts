// What the explorer works out without touching Deck: paths (on this PC and on a server), the
// breadcrumb, sorting, the labels in each column, and what a copy will run into. Pure, so
// files.check.mjs runs it in node.

/** One entry of a folder, as Deck lists it. */
export interface Entry { name: string; path: string; dir: boolean; mtimeMs: number; size: number; hidden: boolean }

// ---- paths -------------------------------------------------------------------------------------
//
// A path here is a Windows one (`C:\Users\Hasan`, a share `\\server\share\x`) or a server folder
// as Deck writes it, `host:/srv/x` (`host+sudo:/…` for root). A host is at least two characters,
// so `D:/x` is never taken for one: the same rule as Deck's remotepath.ts.

const REMOTE = /^([A-Za-z0-9._@-]{2,})(\+sudo)?:(\/.*)$/;
export const isRemote = (p: string) => REMOTE.test(p);

// A phone's or camera's folder, as Windows' shell names it (Deck's shellList): the device is
// `::{This PC}\\\?\usb#…#{…}`, and below it come `\SID-{…}` and `\{object id}` parts. The parts
// are the device's ids, not names: a title or a breadcrumb asks Deck for the names (shellParents).
export const isDevice = (p: string) => p.startsWith("::{");
const DEVICE_ROOT = /^::\{[^}]+\}\\\\\\\?\\[^\\]+/;
/** The device a phone path is on: its top, which has no parent. */
export const deviceRoot = (p: string) => DEVICE_ROOT.exec(p)?.[0] ?? null;

// An app's private folder on a phone, over adb (adb.ts): `::adb/<serial>` is the phone (its
// debuggable apps), `::adb/<serial>/<package>` the app's /data/data/<package>, then its folders.
// Real names all the way down, unlike a phone over USB file transfer.
export const isAdb = (p: string) => p.startsWith("::adb/");
const ADB = /^::adb\/([^/]+)(?:\/([^/]+)(\/.*)?)?$/;
export const adbRoot = (serial: string) => `::adb/${serial}`;
/** The phone, the app and the path inside the app's folder ("" for the folder itself). */
export function adbParts(p: string): { serial: string; pkg: string; rel: string } | null {
  const m = ADB.exec(p.replace(/\/+$/, ""));
  return m ? { serial: m[1], pkg: m[2] ?? "", rel: m[3] ?? "" } : null;
}
/** Where an adb path is on the phone. */
export const adbAbs = (pkg: string, rel: string) => `/data/data/${pkg}${rel}`;
/** Not this PC's disk: a server's folder, a phone's over USB, an app's over adb. */
export const offPc = (p: string) => isRemote(p) || isDevice(p) || isAdb(p);

/** The folder holding `p`, or null at a top: a drive, a share, a server's `/`. */
export function parentOf(p: string): string | null {
  if (isAdb(p)) {
    const a = adbParts(p);
    if (!a || !a.pkg) return null;
    return a.rel ? p.replace(/\/+$/, "").replace(/\/[^/]+$/, "") : adbRoot(a.serial);
  }
  if (isDevice(p)) {
    const root = deviceRoot(p);
    if (!root || p.length <= root.length) return null;
    const at = p.lastIndexOf("\\");
    return at >= root.length ? p.slice(0, at) : root;
  }
  const r = REMOTE.exec(p);
  if (r) {
    const path = r[3].replace(/\/+$/, "");
    if (!path) return null;
    const up = path.slice(0, path.lastIndexOf("/")) || "/";
    return `${r[1]}${r[2] ?? ""}:${up}`;
  }
  const w = p.replace(/\//g, "\\").replace(/\\+$/, "");
  if (/^[A-Za-z]:$/.test(w)) return null;
  const share = /^\\\\[^\\]+\\[^\\]+$/.test(w);
  if (share) return null;
  const at = w.lastIndexOf("\\");
  if (at < 0) return null;
  const up = w.slice(0, at);
  return /^[A-Za-z]:$/.test(up) ? up + "\\" : up;
}

/** `name` inside folder `dir`. */
export function joinPath(dir: string, name: string): string {
  if (isAdb(dir)) return `${dir.replace(/\/+$/, "")}/${name}`;
  if (isRemote(dir)) return dir.endsWith("/") ? dir + name : `${dir}/${name}`;
  return dir.endsWith("\\") || dir.endsWith("/") ? dir + name : `${dir}\\${name}`;
}

/** The last part of a path, for a title. A drive is `C:`, a server's root its host. */
export function baseName(p: string): string {
  if (isAdb(p)) return p.replace(/\/+$/, "").split("/").pop() ?? p;
  const r = REMOTE.exec(p);
  if (r) return r[3].replace(/\/+$/, "").split("/").pop() || r[1];
  const w = p.replace(/\//g, "\\").replace(/\\+$/, "");
  return w.split("\\").pop() || w;
}

/** The breadcrumb: each folder from the top down, with the path it opens. */
export function crumbs(p: string): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [];
  for (let cur: string | null = p; cur; cur = parentOf(cur)) out.unshift({ label: crumbLabel(cur), path: cur });
  return out;
}
function crumbLabel(p: string): string {
  const r = REMOTE.exec(p);
  if (r && r[3].replace(/\/+$/, "") === "") return r[1];
  const b = baseName(p);
  return b;
}

/** A path for comparing: one file however its path was spelled (slashes, case on Windows). */
export const samePath = (a: string, b: string) => key(a) === key(b);
const key = (p: string) => (isRemote(p) ? p.replace(/\/+$/, "") : p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase());

// ---- sorting -----------------------------------------------------------------------------------

export type SortKey = "name" | "date" | "type" | "size";
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Folders first, then files; within each, by `by` (`asc` false reverses), name breaking ties. */
export function sortEntries(list: Entry[], by: SortKey, asc: boolean): Entry[] {
  const dir = asc ? 1 : -1;
  const cmp = (a: Entry, b: Entry) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    let c = 0;
    if (by === "date") c = a.mtimeMs - b.mtimeMs;
    else if (by === "size") c = a.size - b.size;
    else if (by === "type") c = collator.compare(typeLabel(a), typeLabel(b));
    return (c || collator.compare(a.name, b.name)) * dir;
  };
  return [...list].sort(cmp);
}

// ---- labels ------------------------------------------------------------------------------------

/** A name's extension, lowercased without the dot, or "" for none (a dotfile's name alone has none). */
export function extOf(name: string): string {
  const at = name.lastIndexOf(".");
  return at > 0 ? name.slice(at + 1).toLowerCase() : "";
}

const TYPES: Record<string, string> = {
  md: "Markdown", txt: "Text", json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML", csv: "CSV",
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  rs: "Rust", dart: "Dart", py: "Python", go: "Go", java: "Java", kt: "Kotlin", cs: "C#", cpp: "C++", c: "C", h: "C header",
  html: "HTML", htm: "HTML", css: "CSS", scss: "SCSS", sql: "SQL", sh: "Shell script", ps1: "PowerShell", bat: "Batch", cmd: "Batch",
  heic: "HEIC image", heif: "HEIF image", avif: "AVIF image", tif: "TIFF image", tiff: "TIFF image",
  png: "PNG image", jpg: "JPEG image", jpeg: "JPEG image", gif: "GIF image", webp: "WebP image", svg: "SVG image", ico: "Icon", bmp: "Bitmap",
  mp4: "MP4 video", mov: "QuickTime video", mkv: "Matroska video", webm: "WebM video", mp3: "MP3 audio", wav: "WAV audio", flac: "FLAC audio", m4a: "M4A audio",
  pdf: "PDF document", doc: "Word document", docx: "Word document", xls: "Excel sheet", xlsx: "Excel sheet", ppt: "PowerPoint", pptx: "PowerPoint",
  zip: "ZIP archive", "7z": "7-Zip archive", rar: "RAR archive", gz: "Gzip archive", tar: "Tar archive",
  exe: "Application", msi: "Installer", dll: "Library", lnk: "Shortcut", ttf: "Font", otf: "Font", woff: "Font", woff2: "Font",
};

/** The Type column: "Folder", a known kind, or "XYZ file". */
export function typeLabel(e: Pick<Entry, "name" | "dir">): string {
  if (e.dir) return "Folder";
  const ext = extOf(e.name);
  return TYPES[ext] ?? (ext ? `${ext.toUpperCase()} file` : "File");
}

/** Bytes as Explorer's Size column has them: whole KB rounded up below a megabyte, then MB, GB. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(bytes ? 1 : 0, Math.ceil(bytes / 1024)).toLocaleString("en")} KB`;
  const units = ["MB", "GB", "TB"];
  let v = bytes / (1024 * 1024), i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("en")} ${units[i]}`;
}

/** Free space for the sidebar: "88 GB free". */
export const freeLabel = (bytes: number) => `${sizeLabel(bytes)} free`;

/** What the preview pane can show. */
export type PreviewKind = "image" | "photo" | "text" | "media" | "pdf" | "none";
const TEXT = new Set(["md", "txt", "json", "yaml", "yml", "toml", "xml", "csv", "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "dart",
  "py", "go", "java", "kt", "cs", "cpp", "c", "h", "html", "htm", "css", "scss", "sql", "sh", "ps1", "bat", "cmd", "ini", "cfg", "log", "env", "gitignore"]);
const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]);
/** Pictures the page cannot draw but Windows can (with its HEIF extension, for HEIC): shown by the
 *  shell's thumbnail, as a PDF's first page is. */
const PHOTOS = new Set(["heic", "heif", "tif", "tiff", "dng", "cr2", "cr3", "nef", "arw", "raf", "orf", "rw2"]);
const MEDIA = new Set(["mp4", "mov", "mkv", "webm", "mp3", "wav", "flac", "m4a", "ogg"]);
export function previewKind(name: string): PreviewKind {
  const ext = extOf(name) || name.toLowerCase().replace(/^\./, "");
  if (IMAGES.has(ext)) return "image";
  if (PHOTOS.has(ext)) return "photo";
  if (MEDIA.has(ext)) return "media";
  if (ext === "pdf") return "pdf";
  if (TEXT.has(ext)) return "text";
  return "none";
}

// ---- copying -----------------------------------------------------------------------------------

/** A name already in the folder being copied into, and whether it is a folder (which cannot be
 *  replaced, only skipped or kept beside: a copy cannot merge two folders). */
export interface Clash { source: string; name: string; folder: boolean }

/** Which of `sources` would land on a name `dest` already has. */
export function clashes(sources: { path: string; dir: boolean }[], dest: Entry[]): Clash[] {
  const taken = new Map(dest.map((d) => [d.name.toLowerCase(), d]));
  return sources.flatMap((s) => {
    const name = baseName(s.path);
    const there = taken.get(name.toLowerCase());
    return there ? [{ source: s.path, name, folder: s.dir || there.dir }] : [];
  });
}

/** Whether `dest` is `src` itself or inside it: a folder cannot be copied or moved into itself. */
export function insideItself(src: string, dest: string): boolean {
  return samePath(src, dest) || key(dest).startsWith(key(src) + (isRemote(src) ? "/" : "\\"));
}

/** A search's name matches: every word, anywhere in the name, case ignored. */
/**
 * Type to select, as Explorer does: the index to move to for what has been typed so far, or -1.
 * One letter (or the same letter again and again) moves on to the next name starting with it,
 * wrapping round; a longer prefix stays on the current name while it still matches.
 */
export function typeAhead(names: readonly string[], at: number, typed: string): number {
  const t = typed.toLowerCase();
  const same = [...t].every((c) => c === t[0]);
  const want = same ? t[0] : t;
  const start = same ? at + 1 : Math.max(at, 0);
  for (let k = 0; k < names.length; k++) {
    const i = (start + k) % names.length;
    if (names[i].toLowerCase().startsWith(want)) return i;
  }
  return -1;
}

export function nameMatches(name: string, query: string): boolean {
  const n = name.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => n.includes(w));
}

/** Same drive (C: and C:), or the same server: where a plain drop moves rather than copies. */
export function sameVolume(a: string, b: string): boolean {
  const vol = (p: string) => (isRemote(p) ? p.slice(0, p.indexOf(":")) : p.slice(0, 2)).toLowerCase();
  return vol(a) === vol(b);
}

/** Whether these files can be dropped into `dir`: not into one of themselves, nor where they are. */
export function canDrop(items: { path: string }[], dir: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
  return items.every((s) => !insideItself(s.path, dir) && norm(parentOf(s.path) ?? "") !== norm(dir));
}

// ---- grouping ----------------------------------------------------------------------------------

/** What the listing is grouped by (Sort, Group by), or nothing. */
export type GroupKey = "name" | "date" | "type" | "size";
export interface Group { label: string; entries: Entry[] }

const DAY = 24 * 60 * 60 * 1000;
/** Explorer's date groups, newest first: the label for `ms`, as seen at `now`. */
function dateGroup(ms: number, now: number): string {
  const d = new Date(now), today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const weekStart = today - ((d.getDay() + 6) % 7) * DAY; // weeks start on Monday
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const lastMonthStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
  const yearStart = new Date(d.getFullYear(), 0, 1).getTime();
  if (ms >= today) return "Today";
  if (ms >= today - DAY) return "Yesterday";
  if (ms >= weekStart) return "Earlier this week";
  if (ms >= weekStart - 7 * DAY) return "Last week";
  if (ms >= monthStart) return "Earlier this month";
  if (ms >= lastMonthStart) return "Last month";
  if (ms >= yearStart) return "Earlier this year";
  return "A long time ago";
}
const DATE_ORDER = ["Today", "Yesterday", "Earlier this week", "Last week", "Earlier this month", "Last month", "Earlier this year", "A long time ago"];
/** Explorer's size groups, by what a file weighs; a folder has no size of its own. */
const SIZES: [number, string][] = [[0, "Empty (0 KB)"], [16 * 1024, "Tiny (0 - 16 KB)"], [1024 ** 2, "Small (16 KB - 1 MB)"],
  [128 * 1024 ** 2, "Medium (1 - 128 MB)"], [1024 ** 3, "Large (128 MB - 1 GB)"], [4 * 1024 ** 3, "Huge (1 - 4 GB)"], [Infinity, "Gigantic (> 4 GB)"]];
function sizeGroup(e: Entry): string {
  if (e.dir) return "Folders";
  return SIZES.find(([max]) => e.size <= max)![1];
}
/** Explorer's name groups: digits, three letter ranges, everything else. */
function nameGroup(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  if (/[0-9]/.test(c)) return "0 - 9";
  if (c >= "A" && c <= "H") return "A - H";
  if (c >= "I" && c <= "P") return "I - P";
  if (c >= "Q" && c <= "Z") return "Q - Z";
  return "Other";
}

/**
 * The entries in groups, in the order the groups are shown; each group keeps the entries' order
 * (the sort). Types are alphabetical with folders first; names, dates and sizes in their own order.
 */
export function groupEntries(list: Entry[], by: GroupKey, now = Date.now()): Group[] {
  const label = by === "name" ? (e: Entry) => nameGroup(e.name)
    : by === "date" ? (e: Entry) => dateGroup(e.mtimeMs, now)
    : by === "size" ? sizeGroup
    : (e: Entry) => typeLabel(e);
  const groups = new Map<string, Entry[]>();
  for (const e of list) { const k = label(e); const g = groups.get(k); if (g) g.push(e); else groups.set(k, [e]); }
  const order = by === "date" ? DATE_ORDER
    : by === "size" ? ["Folders", ...SIZES.map(([, l]) => l)]
    : by === "name" ? ["0 - 9", "A - H", "I - P", "Q - Z", "Other"]
    : ["Folder", ...[...groups.keys()].filter((k) => k !== "Folder").sort((a, b) => collator.compare(a, b))];
  return order.filter((k) => groups.has(k)).map((k) => ({ label: k, entries: groups.get(k)! }));
}

/** A name kept beside one already taken, as Explorer does it: `notes (2).txt`, then (3), and on. */
export function keptName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 2; ; n++) { const c = `${stem} (${n})${ext}`; if (!used.has(c.toLowerCase())) return c; }
}
