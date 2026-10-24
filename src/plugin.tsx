// Files: a file explorer for Deck, as a tab or a pane. See Files.tsx.
import { Files } from "./Files";
import { clearListings } from "./folders";
import { clearThumbs } from "./thumbs";
import { stopOpenIn } from "./openin";

export { settings } from "./openin";

export default Files;
export const PaneView = Files;

// Defaults only; a rebinding in Settings › Keybindings wins. They hold while the explorer has
// focus: the list ones only in the list itself, so a text box keeps Ctrl+C, Delete and the rest.
// Arrows, Enter and Backspace are the list's own and are not listed here.
export const keybindings = () => [
  { id: "rename", title: "Rename", defaultChord: "f2" },
  { id: "delete", title: "Move to the Recycle Bin", defaultChord: "delete" },
  { id: "delete-forever", title: "Delete for good", defaultChord: "shift+delete" },
  { id: "copy", title: "Copy", defaultChord: "ctrl+c" },
  { id: "cut", title: "Cut", defaultChord: "ctrl+x" },
  { id: "paste", title: "Paste", defaultChord: "ctrl+v" },
  { id: "select-all", title: "Select everything", defaultChord: "ctrl+a" },
  { id: "copy-path", title: "Copy the path", defaultChord: "ctrl+shift+c" },
  { id: "new-folder", title: "New folder", defaultChord: "ctrl+shift+n" },
  { id: "refresh", title: "Refresh", defaultChord: "f5" },
  { id: "back", title: "Back", defaultChord: "alt+arrowleft" },
  { id: "forward", title: "Forward", defaultChord: "alt+arrowright" },
  { id: "up", title: "Up a folder", defaultChord: "alt+arrowup" },
  { id: "search", title: "Search this folder", defaultChord: "ctrl+f" },
];

/** Before a reload re-imports the plugin: the thumbnails' blob URLs are released. */
export function dispose() {
  stopOpenIn();
  clearThumbs();
  clearListings();
}
