// node usage.check.mjs: the disk-usage report's pure logic (src/usage/), compiled from the real
// source: adding measured folders and loose files into one report, ages, kinds, the CSV, the treemap
// layout, and grouping duplicates.
import assert from "node:assert/strict";
import { build } from "esbuild";

const load = async (file) => {
  const out = await build({ entryPoints: [new URL(file, import.meta.url).pathname.replace(/^\/(\w:)/, "$1")], bundle: true, write: false, format: "esm", platform: "node" });
  return import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
};
const R = await load("./src/usage/report.ts");
const T = await load("./src/usage/treemap.ts");
const D = await load("./src/usage/dupes.ts");

const MB = 1 << 20, DAY = 86_400_000, now = Date.UTC(2026, 10, 23);

// Paths and names, on a drive and in a folder, with either separator.
assert.equal(R.joinPath("D:\\", "Games"), "D:\\Games");
assert.equal(R.joinPath("D:\\Flutter", "deck"), "D:\\Flutter\\deck");
assert.equal(R.joinPath("/home/me", "src"), "/home/me/src");
assert.equal(R.nameOf("D:\\"), "D:");
assert.equal(R.nameOf("D:\\Flutter\\deck\\"), "deck");

// Ages: the bucket edges are inclusive, and anything older lands in the last.
assert.equal(R.ageBucket(now - 10 * DAY, now), 0);
assert.equal(R.ageBucket(now - 30 * DAY, now), 0);
assert.equal(R.ageBucket(now - 31 * DAY, now), 1);
assert.equal(R.ageBucket(now - 4000 * DAY, now), 5);

// Two measured folders and the root's loose files, added into one report.
const part = (name, size, extra = {}) => ({
  tree: { name, size, files: 10, newest: now - DAY, children: [] },
  big: [{ path: `D:\\${name}\\big.bin`, size: 5 * MB, mtime: now - DAY }],
  types: [{ ext: "bin", size, count: 10 }], ages: [[size, 10], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], skipped: 1, dirs: 3, ...extra,
});
let r = R.emptyReport("D:\\");
r = R.addFolder(r, part("Small", 100 * MB));
r = R.addFolder(r, part("Big", 900 * MB));
r = R.addFolder(r, part("Tiny", 1000));
r = R.addLooseFiles(r, [{ path: "D:\\a.zip", name: "a.zip", size: 2 * MB, mtimeMs: now - 3000 * DAY }], now);
assert.equal(r.tree.size, 1002 * MB + 1000);
assert.deepEqual(r.tree.children.map((c) => c.name), ["Big", "Small"], "largest first, and a folder under 1 MB folded into the root");
assert.equal(R.restOf(r.tree), 2 * MB + 1000, "the loose file and the folded folder");
assert.equal(r.tree.files, 31);
assert.equal(r.skipped, 3);
assert.deepEqual(r.types.map((t) => t.ext), ["bin", "zip"]);
assert.equal(r.types[0].count, 30);
assert.deepEqual(r.ages[5], [2 * MB, 1], "the old zip in the last bucket");
assert.equal(r.big.length, 4, "three measured large files and the loose one");
assert.equal(R.nodeAt(r.tree, ["Big"]).size, 900 * MB);
assert.equal(R.nodeAt(r.tree, ["Nope"]), null);

// Kinds: by extension, unknown ones as Other, summed largest first.
assert.equal(R.kindOf("mkv").name, "Video");
assert.equal(R.kindOf("weird").name, "Other");
assert.deepEqual(R.byKind([{ ext: "zip", size: 5, count: 1 }, { ext: "7z", size: 5, count: 2 }, { ext: "mp4", size: 3, count: 1 }]).map((k) => [k.name, k.size, k.count]), [["Archives", 10, 3], ["Video", 3, 1]]);

// When it last changed.
assert.equal(R.agoLabel(now - 2 * 3600_000, now), "today");
assert.equal(R.agoLabel(now - 5 * DAY, now), "5 days ago");
assert.equal(R.agoLabel(now - 65 * DAY, now), "2 months ago");
assert.equal(R.agoLabel(now - 800 * DAY, now), "2 years ago");

// The CSV: one row per listed folder, a quoted path where it needs one.
const csv = R.toCsv({ ...R.emptyReport("D:\\x"), tree: { name: "x", size: 3, files: 1, newest: 0, children: [{ name: "a,b", size: 3, files: 1, newest: 0, children: [] }] } });
assert.equal(csv, 'Path,Size (bytes),Files,Last change\r\nD:\\x,3,1,\r\n"D:\\x\\a,b",3,1,\r\n');

// The treemap: every area in proportion, nothing outside the box, nothing overlapping.
const box = { x: 0, y: 0, w: 600, h: 400 }, sizes = [500, 300, 200, 100, 50, 30, 20];
const rects = T.squarify(sizes, box);
const total = sizes.reduce((a, b) => a + b, 0);
rects.forEach((q, i) => {
  assert.ok(Math.abs(q.w * q.h - (sizes[i] / total) * 600 * 400) < 1e-6, "area in proportion");
  assert.ok(q.x >= -1e-9 && q.y >= -1e-9 && q.x + q.w <= 600 + 1e-6 && q.y + q.h <= 400 + 1e-6, "inside the box");
});
for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
  const a = rects[i], b = rects[j];
  const overlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  assert.ok(overlap < 1e-6, "no overlap");
}
assert.deepEqual(T.squarify([], box), []);
// A long tail of tiny sizes stays inside the box.
const tail = T.squarify([1e9, ...Array.from({ length: 60 }, (_, i) => 1000 - i * 10)], { x: 10, y: 20, w: 300, h: 200 });
assert.ok(tail.every((q) => q.x >= 10 && q.y >= 20 && q.x + q.w <= 310 + 1e-9 && q.y + q.h <= 220 + 1e-9 && q.w >= 0 && q.h >= 0), "nothing past the box");

// Duplicates: same size first, then same content; the newest copy first in each set.
const f = (path, size, mtime = 0) => ({ path, size, mtime });
const groups = D.sameSize([f("a", 10), f("b", 20), f("c", 10), f("d", 20), f("e", 30)]);
assert.deepEqual(groups.map((g) => g.map((x) => x.path)), [["b", "d"], ["a", "c"]], "only shared sizes, largest first");
const sets = D.sameContent([f("x", 7, 1), f("y", 7, 3), f("z", 7, 2), f("w", 7, 4)], ["h1", "h1", "h2", null]);
assert.deepEqual(sets.map((g) => g.map((x) => x.path)), [["y", "x"]], "a lone hash and an unreadable file are no set");
assert.equal(D.freeable([[f("a", 10), f("b", 10), f("c", 10)], [f("d", 5), f("e", 5)]]), 25);

console.log("usage: all checks passed");
