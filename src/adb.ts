// An Android app's private folder (/data/data/<package>), over adb, as Android Studio's Device
// Explorer shows it. Only a debuggable app's (a debug build's): `run-as <package>` is how adb reads
// as the app, and Android refuses it for any other app.
//
// Every call is Deck's exec of adb, so nothing here is native code. Reading a file or a folder
// goes through a tar the phone writes in /data/local/tmp (adb's shell may write there, the app may
// not), pulled whole, which keeps binary files (an app's SQLite databases) intact.
import { exec, fsDelete, fsHomeDir } from "../shim/bridge.js";
import { adbAbs, adbParts, adbRoot, joinPath, type Entry } from "./logic";

let exe: Promise<string> | null = null;
/** adb on PATH, or Android Studio's, in the SDK's usual folder. */
function adb(): Promise<string> {
  exe ??= exec("adb", ["version"]).then(
    (r: { code: number }) => (r.code === 0 ? "adb" : Promise.reject(new Error("adb did not run"))),
  ).catch(async () => `${await fsHomeDir()}\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe`);
  return exe;
}

/** adb's answer to `args`, its output when it worked. */
async function run(args: string[]): Promise<string> {
  const r = (await exec(await adb(), args)) as { stdout: string; stderr: string; code: number };
  if (r.code !== 0 || /^run-as: /m.test(r.stderr)) throw new Error(explain(r.stderr || r.stdout));
  return r.stdout;
}
function explain(err: string): string {
  const m = /run-as: package not debuggable: (\S+)/.exec(err);
  if (m) return `${m[1]} is not a debug build: Android only lets adb read the files of an app that is debuggable.`;
  if (/is unknown|not found/i.test(err)) return "That app is not on the phone any more.";
  return err.trim() || "adb did not answer";
}

/** One shell argument for the phone's sh, in double quotes. */
const q = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

export interface AdbDevice { serial: string; name: string; path: string }

/** Phones adb can reach (USB debugging on, this PC allowed), each with the name set on it. */
export async function adbDevices(): Promise<AdbDevice[]> {
  const out = await run(["devices"]).catch(() => "");
  const serials = out.split(/\r?\n/).map((l) => /^(\S+)\tdevice$/.exec(l.trim())?.[1]).filter((s): s is string => !!s);
  return Promise.all(serials.map(async (serial) => {
    const name = (await run(["-s", serial, "shell", "settings get global device_name"]).catch(() => "")).trim();
    return { serial, name: name && name !== "null" ? name : serial, path: adbRoot(serial) };
  }));
}

/** A folder: the phone's debuggable apps at its top, then the app's own files. */
export async function adbList(path: string): Promise<Entry[]> {
  const p = adbParts(path);
  if (!p) throw new Error(`${path} is not an adb path`);
  if (!p.pkg) {
    // One shell for the whole list: asking each app in turn from here would take a call per app.
    // The loop ends on `true`: its own status is the last app's, a failure when it is not debuggable.
    const out = await run(["-s", p.serial, "shell", "for p in $(pm list packages -3 2>/dev/null | cut -d: -f2); do run-as $p true 2>/dev/null && echo $p; done; true"]);
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      .map((pkg) => ({ name: pkg, path: `${path}/${pkg}`, dir: true, mtimeMs: 0, size: 0, hidden: false }));
  }
  const dir = adbAbs(p.pkg, p.rel);
  const out = await run(["-s", p.serial, "shell", `run-as ${p.pkg} sh -c 'cd ${q(dir)} || exit 2; stat -c "%F|%s|%Y|%n" .* * 2>/dev/null; true'`]);
  return out.split(/\r?\n/).flatMap((line) => {
    const m = /^([^|]+)\|(\d+)\|(\d+)\|(.+)$/.exec(line.trim());
    if (!m || m[4] === "." || m[4] === ".." || m[4] === "*" || m[4] === ".*") return [];
    const isDir = m[1] === "directory";
    return [{ name: m[4], path: `${path}/${m[4]}`, dir: isDir, mtimeMs: Number(m[3]) * 1000, size: isDir ? 0 : Number(m[2]), hidden: m[4].startsWith(".") }];
  });
}

/** A text file's contents, for the preview (an app's shared_prefs XML, its JSON). */
export async function adbRead(path: string): Promise<string> {
  const p = adbParts(path);
  if (!p?.pkg || !p.rel) throw new Error(`${path} is not a file in an app`);
  return run(["-s", p.serial, "shell", `run-as ${p.pkg} cat ${q(adbAbs(p.pkg, p.rel))}`]);
}

/**
 * Copy files and folders of one app folder into the folder `into` on this PC, as they are. Through
 * a tar the phone writes and adb pulls, and Windows' tar opens.
 */
export async function adbPull(paths: string[], into: string): Promise<void> {
  const first = adbParts(paths[0]);
  if (!first?.pkg) throw new Error("Only an app's files can be copied");
  const parent = first.rel.slice(0, first.rel.lastIndexOf("/"));
  if (paths.some((x) => { const o = adbParts(x); return !o || o.serial !== first.serial || o.pkg !== first.pkg || o.rel.slice(0, o.rel.lastIndexOf("/")) !== parent; }))
    throw new Error("Copy from one folder at a time");
  const names = paths.map((x) => x.slice(x.lastIndexOf("/") + 1));
  const onPhone = `/data/local/tmp/deck-files-${Date.now().toString(36)}.tar`;
  const local = joinPath(into, ".deck-from-phone.tar");
  const { serial, pkg } = first;
  // The redirect is the adb shell's, which may write /data/local/tmp; the tar is the app's (run-as).
  await run(["-s", serial, "shell", `run-as ${pkg} tar cf - -C ${q(adbAbs(pkg, parent))} ${names.map(q).join(" ")} > ${onPhone}`]);
  try {
    await run(["-s", serial, "pull", onPhone, local]);
    const r = (await exec("tar", ["xf", local, "-C", into])) as { code: number; stderr: string };
    if (r.code !== 0) throw new Error(`the copy could not be unpacked: ${r.stderr.trim()}`);
  } finally {
    await run(["-s", serial, "shell", `rm -f ${onPhone}`]).catch(() => { /* gone with the phone */ });
    await fsDelete(local).catch(() => { /* not pulled */ });
  }
}
