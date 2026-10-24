// node files.check.mjs — the explorer's pure logic (src/logic.ts), compiled from the real source:
// paths on this PC and on a server, the breadcrumb, sorting, the column labels, and what a copy
// will run into.
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = await build({ entryPoints: [new URL("./src/logic.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")], bundle: true, write: false, format: "esm", platform: "node" });
const L = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

// Up a level, on Windows, a share and a server; a top has nowhere to go.
assert.equal(L.parentOf(String.raw`C:\Users\Hasan`), String.raw`C:\Users`);
assert.equal(L.parentOf(String.raw`C:\Users`), "C:\\");
assert.equal(L.parentOf("C:\\"), null);
assert.equal(L.parentOf("D:/Flutter/deck/"), String.raw`D:\Flutter`);
assert.equal(L.parentOf(String.raw`\\nas\media\films`), String.raw`\\nas\media`);
assert.equal(L.parentOf(String.raw`\\nas\media`), null);
assert.equal(L.parentOf("vps:/srv/backup"), "vps:/srv");
assert.equal(L.parentOf("vps:/srv"), "vps:/");
assert.equal(L.parentOf("vps:/"), null);
assert.equal(L.parentOf("vps+sudo:/etc/caddy"), "vps+sudo:/etc");
// A drive letter is never a server.
assert.equal(L.isRemote("D:/x"), false);
assert.equal(L.isRemote("vps:/x"), true);

assert.equal(L.joinPath("C:\\", "Users"), String.raw`C:\Users`);

// Dragging files: a plain drop moves on the same drive or server and copies elsewhere; never into
// one of the folders dragged, nor into the folder they are already in.
assert.ok(L.sameVolume(String.raw`C:\a\x.txt`, "c:\\b"));
assert.ok(!L.sameVolume(String.raw`C:\a\x.txt`, "D:\\b"));
assert.ok(L.sameVolume("vps:/srv/a", "vps:/home"));
assert.ok(!L.sameVolume("vps:/srv/a", "mac:/srv"));
assert.ok(L.canDrop([{ path: String.raw`C:\a\x.txt` }], String.raw`C:\b`));
assert.ok(!L.canDrop([{ path: String.raw`C:\a\x.txt` }], "C:\\A\\"), "where it already is, a trailing \\ and case aside");
assert.ok(!L.canDrop([{ path: String.raw`C:\a` }], String.raw`C:\a\sub`), "into itself");
assert.ok(!L.canDrop([{ path: String.raw`C:\a` }], String.raw`C:\a`), "onto itself");
assert.equal(L.joinPath(String.raw`C:\Users`, "Hasan"), String.raw`C:\Users\Hasan`);
assert.equal(L.joinPath("vps:/", "srv"), "vps:/srv");
assert.equal(L.joinPath("vps:/srv", "x"), "vps:/srv/x");

assert.deepEqual(L.crumbs(String.raw`D:\Flutter\deck`).map((c) => [c.label, c.path]),
  [["D:", "D:\\"], ["Flutter", String.raw`D:\Flutter`], ["deck", String.raw`D:\Flutter\deck`]]);
assert.deepEqual(L.crumbs("vps:/srv/backup").map((c) => [c.label, c.path]),
  [["vps", "vps:/"], ["srv", "vps:/srv"], ["backup", "vps:/srv/backup"]]);

// The same file however its path is spelled.
assert.equal(L.samePath("C:\\Users\\H\\", "c:/users/h"), true);
assert.equal(L.samePath("vps:/A", "vps:/a"), false, "a server's paths keep their case");

// Folders first; names in natural order (2 before 10); each column; descending.
const e = (name, dir, mtimeMs = 0, size = 0) => ({ name, path: name, dir, mtimeMs, size, hidden: false });
const list = [e("b10.txt", false, 3, 50), e("src", true, 9), e("b2.txt", false, 1, 900), e("A.md", false, 2, 10), e("docs", true, 1)];
assert.deepEqual(L.sortEntries(list, "name", true).map((x) => x.name), ["docs", "src", "A.md", "b2.txt", "b10.txt"]);
assert.deepEqual(L.sortEntries(list, "name", false).map((x) => x.name), ["src", "docs", "b10.txt", "b2.txt", "A.md"]);
assert.deepEqual(L.sortEntries(list, "size", true).map((x) => x.name), ["docs", "src", "A.md", "b10.txt", "b2.txt"]);
assert.deepEqual(L.sortEntries(list, "date", true).map((x) => x.name), ["docs", "src", "b2.txt", "A.md", "b10.txt"]);
assert.deepEqual(L.sortEntries(list, "type", true).map((x) => x.name), ["docs", "src", "A.md", "b2.txt", "b10.txt"]);

// Columns, as Explorer writes them.
assert.equal(L.typeLabel({ name: "a.png", dir: false }), "PNG image");
assert.equal(L.typeLabel({ name: "a.xyz", dir: false }), "XYZ file");
assert.equal(L.typeLabel({ name: "Makefile", dir: false }), "File");
assert.equal(L.typeLabel({ name: "src", dir: true }), "Folder");
assert.equal(L.extOf(".gitignore"), "");
assert.equal(L.sizeLabel(0), "0 KB");
assert.equal(L.sizeLabel(1), "1 KB");
assert.equal(L.sizeLabel(24 * 1024 + 1), "25 KB");
assert.equal(L.sizeLabel(1.5 * 1024 * 1024), "1.5 MB");
assert.equal(L.sizeLabel(633 * 1024 ** 3), "633 GB");
assert.equal(L.previewKind("a.PNG"), "image");
assert.equal(L.previewKind("a.ts"), "text");
assert.equal(L.previewKind(".gitignore"), "text");
assert.equal(L.previewKind("a.pdf"), "pdf");
assert.equal(L.previewKind("a.exe"), "none");

// A copy's clashes: names compared without case; a folder on either side cannot be replaced.
const dest = [e("Report.pdf", false), e("photos", true)];
assert.deepEqual(L.clashes([{ path: String.raw`C:\x\report.pdf`, dir: false }, { path: String.raw`C:\x\new.txt`, dir: false }, { path: String.raw`C:\x\photos`, dir: true }], dest),
  [{ source: String.raw`C:\x\report.pdf`, name: "report.pdf", folder: false }, { source: String.raw`C:\x\photos`, name: "photos", folder: true }]);
assert.equal(L.insideItself(String.raw`C:\a`, String.raw`C:\a\b`), true);
assert.equal(L.insideItself(String.raw`C:\a`, String.raw`C:\ab`), false);
assert.equal(L.insideItself("vps:/a", "vps:/a/b"), true);

assert.equal(L.nameMatches("ReviewPanel.tsx", "review panel"), true);
assert.equal(L.nameMatches("ReviewPanel.tsx", "review diff"), false);
const names = ["android", "Program Files", "Program Files (x86)", "ProgramData", "Python311", "tools"];
assert.equal(L.typeAhead(names, -1, "p"), 1);
assert.equal(L.typeAhead(names, 1, "pp"), 2);     // the same letter again: the next one
assert.equal(L.typeAhead(names, 4, "p"), 1);      // wraps round
assert.equal(L.typeAhead(names, 1, "pr"), 1);     // a longer prefix stays while it matches
assert.equal(L.typeAhead(names, 1, "py"), 4);
assert.equal(L.typeAhead(names, 0, "progra"), 1);
assert.equal(L.typeAhead(names, 0, "z"), -1);
console.log("files: all checks passed");
