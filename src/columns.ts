// The table's columns: their widths, as dragged, and which of them fit. The name takes what is
// left; as the pane narrows, Type goes first, then the date, then the size, so the names are never
// squeezed below NAME_MIN. Pure, for files.check.mjs.

export interface ColWidths { date: number; type: number; size: number }
export type ColKey = keyof ColWidths;

export const DEFAULT_WIDTHS: ColWidths = { date: 150, type: 130, size: 90 };
export const COL_MIN = 60, COL_MAX = 400;
/** The narrowest the name column gets before another column goes. */
export const NAME_MIN = 140;
/** The table's padding, left and right, which the columns cannot use. */
const PAD = 36;

export interface Cols { date: boolean; type: boolean; size: boolean; template: string }

/** Which columns show in a table `w` px wide, and the grid template for them. */
export function colsFor(w: number, widths: ColWidths): Cols {
  const shown = { date: true, type: true, size: true };
  const left = () => w - PAD - (Object.keys(shown) as ColKey[]).reduce((n, k) => n + (shown[k] ? widths[k] : 0), 0);
  for (const k of ["type", "date", "size"] as const) if (left() < NAME_MIN) shown[k] = false;
  const template = ["minmax(0,1fr)", ...(["date", "type", "size"] as const).filter((k) => shown[k]).map((k) => `${widths[k]}px`)].join(" ");
  return { ...shown, template };
}

/** A column's width dragged by `dx` px from `start`: its left edge is dragged, so left is wider. */
export const dragWidth = (start: number, dx: number) => Math.max(COL_MIN, Math.min(COL_MAX, Math.round(start - dx)));
