# Changelog

## Unreleased

- A file dragged onto one of Deck's terminals types its path there.
- Narrow panes: the sidebar hides, with a Places button to show it over the list, and the
  table drops its quieter columns (type, then date, then size) as the pane narrows.
- The table's columns are resized by dragging their edges (double-click resets one), and keep
  their widths.

## 0.4.0 (2026-11-12)

- Go to its workspace finds a project by any of its folders, not only its main one.

## 0.3.0 (2026-11-01)

- Runs on Linux: its paths, copies, disks and the Trash. Phones over USB stay Windows-only. Needs Deck 1.15.0.

## 0.2.2 (2026-10-30)

- A licence, this changelog, a README rewritten with a screenshot, and the permissions it uses
  declared. Built from its own lockfile.

## 0.2.1 (2026-10-25)

- No warning for a phone folder's names while the phone is unplugged
- Memoised rows and tiles, so a click re-renders only the rows it changes
- One date/number formatter per list, not one per row

## 0.2.0 (2026-10-24)

- Rename once, and select a renamed or new item on a phone
- Report through Deck's notifications instead of toast()
- Files opened from Files, as a tab or in a floating window
- Rename, delete and new folders and files inside a debug build's folder
- Copy this PC's files into a debug build's own folder over adb
- Debug builds' own files over adb, as Android Studio's Device Explorer
- Phones in the sidebar; copies on this PC are Windows' own
- Drives in the sidebar by their letter alone, the label as the tooltip
- The sidebar and the preview pane are resized by dragging their edge
- Group by in the Sort menu; SVG tiles show the picture; Preview pane in View, no New button
- The path bar shows the folder you are in when the whole path does not fit
- Sort and View menus in place of the details/tiles switch
- Drag a box to select, drag files to move or copy them; HEIC thumbnails

## 0.1.1 (2026-10-20)

- Ctrl+F and the view's keys find their focus in a floating window

## 0.1.0 (2026-10-19)

- The first version in Deck's plugin registry.
