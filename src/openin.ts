// Where a file opened from Files goes: a tab (the Editor's, or the tab its type opens in), or a
// floating window of its own. The plugin's row in Settings › Where things open, which Deck saves
// in this plugin's `settings` config; read once and again whenever it changes.
import { configRead } from "../shim/bridge.js";
import { listen } from "../shim/event.js";

export const settings = [{
  in: "where-things-open", key: "openIn", title: "Files opened from Files",
  desc: "A file opened in the explorer: in the Editor's tab or the tab its type opens in, or in a floating window.",
  choices: [["float", "Floating window"], ["tab", "Tab"]], default: "tab",
}];

let openIn: "tab" | "float" = "tab";
const read = () => configRead("settings")
  .then((t: string) => { openIn = t.trim() && JSON.parse(t).openIn === "float" ? "float" : "tab"; })
  .catch((e: unknown) => console.warn("[files] settings load failed", e));
void read();
// config-changed names this plugin's own configs as it names them, "settings" (the shim drops data/files/).
const unlisten = listen<string[]>("config-changed", (e: { payload: string[] }) => { if (e.payload.includes("settings")) void read(); });

export const opensInFloat = () => openIn === "float";
/** Before a reload re-imports the plugin (Deck's rule 13). */
export const stopOpenIn = () => { void unlisten.then((f: () => void) => f()); };
