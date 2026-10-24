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

// Grouping, as Explorer's Group by: groups in their own order, each keeping the sort's order.
{
  const now = new Date(2026, 9, 24, 12).getTime(); // a Saturday
  const f = (name, mtimeMs, size = 1, dir = false) => ({ name, path: "C:\\x\\" + name, dir, mtimeMs, size, hidden: false });
  const day = 24 * 60 * 60 * 1000;
  const list = [f("today.txt", now - 1000), f("old.txt", new Date(2020, 0, 1).getTime()), f("yday.txt", now - day), f("mon.txt", new Date(2026, 9, 19, 9).getTime()), f("lastweek.txt", new Date(2026, 9, 14).getTime())];
  assert.deepEqual(L.groupEntries(list, "date", now).map((g) => [g.label, g.entries.map((e) => e.name)]), [
    ["Today", ["today.txt"]], ["Yesterday", ["yday.txt"]], ["Earlier this week", ["mon.txt"]], ["Last week", ["lastweek.txt"]], ["A long time ago", ["old.txt"]],
  ]);
  assert.deepEqual(L.groupEntries([f("b.md", 0), f("dir", 0, 0, true), f("a.txt", 0), f("c.md", 0)], "type").map((g) => [g.label, g.entries.length]),
    [["Folder", 1], ["Markdown", 2], ["Text", 1]], "folders first, then types alphabetically");
  assert.deepEqual(L.groupEntries([f("big", 0, 2 * 1024 ** 3), f("empty", 0, 0), f("d", 0, 0, true), f("s", 0, 100 * 1024)], "size").map((g) => g.label),
    ["Folders", "Empty (0 KB)", "Small (16 KB - 1 MB)", "Huge (1 - 4 GB)"]);
  assert.deepEqual(L.groupEntries([f("zed", 0), f("1st", 0), f("_x", 0), f("apple", 0), f("Mango", 0)], "name").map((g) => g.label),
    ["0 - 9", "A - H", "I - P", "Q - Z", "Other"]);
}

// A phone, as Windows' shell names it: the device has no parent, each folder the one before it.
{
  const phone = String.raw`::{20D04FE0-3AEA-1069-A2D8-08002B30309D}\\\?\usb#vid_04e8&pid_6860&ms_comp_mtp&samsung_android#6&2ce7b1e7&1&0000#{6ac27878-a6fa-4155-ba85-f98f491d4f33}`;
  const storage = phone + String.raw`\SID-{10001,,234073620480}`;
  const pics = storage + String.raw`\{00000123-0000-0000-0000-000000000000}`;
  assert.ok(L.isDevice(phone) && L.isDevice(pics) && !L.isDevice("C:\\x"));
  assert.ok(!L.isRemote(phone), "a phone is not a server");
  assert.equal(L.deviceRoot(pics), phone);
  assert.equal(L.parentOf(phone), null);
  assert.equal(L.parentOf(storage), phone);
  assert.equal(L.parentOf(pics), storage);
  assert.ok(L.sameVolume(pics, storage), "within a phone a drop moves");
  assert.ok(!L.sameVolume(pics, "C:\\x"), "between a phone and this PC it copies");
  assert.ok(!L.canDrop([{ path: pics + "\\{1}" }], pics), "where it already is");
}

// An app's folder over adb: real names, the phone at the top.
{
  const app = "::adb/R5CY207JF2V/com.hassan171.wallet";
  assert.deepEqual(L.adbParts(app + "/shared_prefs/x.xml"), { serial: "R5CY207JF2V", pkg: "com.hassan171.wallet", rel: "/shared_prefs/x.xml" });
  assert.deepEqual(L.adbParts("::adb/R5CY207JF2V"), { serial: "R5CY207JF2V", pkg: "", rel: "" });
  assert.equal(L.parentOf(app + "/shared_prefs/x.xml"), app + "/shared_prefs");
  assert.equal(L.parentOf(app + "/shared_prefs"), app);
  assert.equal(L.parentOf(app), "::adb/R5CY207JF2V");
  assert.equal(L.parentOf("::adb/R5CY207JF2V"), null);
  assert.equal(L.adbAbs("com.hassan171.wallet", "/databases"), "/data/data/com.hassan171.wallet/databases");
  assert.equal(L.joinPath(app, "files"), app + "/files");
  assert.equal(L.baseName(app + "/shared_prefs"), "shared_prefs");
  assert.ok(L.isAdb(app) && !L.isRemote(app) && !L.isDevice(app) && L.offPc(app));
  assert.deepEqual(L.crumbs(app + "/databases").map((c) => c.label), ["R5CY207JF2V", "com.hassan171.wallet", "databases"]);
}

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
