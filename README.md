# Files

A file explorer for Deck, as a tab or a pane: your drives, pinned folders and servers, with tabs
of its own, a preview pane, search by name and inside files, and copy, move, rename and the
Recycle Bin.

- **Places:** pinned folders (right-click a folder, Pin to the sidebar), this PC's drives with
  their free space, and the hosts in `~/.ssh/config`, opened over SSH as `host:/path`.
- **Views:** Details (name, date modified, type, size; click a column to sort) or Tiles, with
  Windows' own thumbnails for pictures, videos and PDFs. Hidden files can be shown from the ⋯ menu.
- **Preview pane:** pictures, videos and songs, text and code, a PDF's first page, and what the
  file is.
- **Opening:** a file opens where Deck opens its kind (Settings › Files: a PDF in the PDF plugin,
  a page in the browser, code in the Editor); anything Deck has nothing for opens in Windows' own
  app. Open with lists every choice. A folder can be opened as a Deck workspace from its menu (or
  switched to, when it is one already).
- **Search:** names, and what is inside files (Deck's ripgrep; files .gitignore leaves out are
  skipped). A whole drive is not searched: open a folder on it first.
- **Changing files:** copy, cut and paste, rename (F2), new folder, the Recycle Bin (Delete) and
  Delete for good (Shift+Delete). A name already taken is asked about: Replace, Keep both or Skip.
  Copying between this PC and a server is not possible yet.

## Keys

The list's own: arrows, Home, End, Page Up and Down (Shift to extend), Enter to open, Backspace
up a folder. While the explorer has focus: F2, Delete, Shift+Delete, Ctrl+C, Ctrl+X, Ctrl+V,
Ctrl+A, Ctrl+Shift+C (copy the path), Ctrl+Shift+N, F5, Alt+Left/Right/Up, Ctrl+F. Each can be
changed in Settings › Keybindings.

## Needs

Deck 1.7.0 or later: folder listings with sizes, the drive list, and where each file type opens.

## Develop

```sh
npm run build   # plugin.js
npm run dev     # rebuild on save into Deck-Dev
npm test        # the paths, sorting, labels and copy clashes (files.check.mjs)
```
