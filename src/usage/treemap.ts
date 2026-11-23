// The squarified treemap layout (Bruls, Huizing and van Wijk): items, largest first, laid in rows
// along the shorter side so each rectangle stays as close to square as it can. Pure.

export interface Rect { x: number; y: number; w: number; h: number }

/** A rectangle for each of `sizes` (largest first, all > 0) inside `box`, in the same order. */
export function squarify(sizes: number[], box: Rect): Rect[] {
  const out: Rect[] = new Array(sizes.length);
  const total = sizes.reduce((s, v) => s + v, 0);
  if (!total || box.w <= 0 || box.h <= 0) return sizes.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  const scale = (box.w * box.h) / total;
  let { x, y, w, h } = box;
  let i = 0;
  // The worst aspect ratio of a row of areas laid along a side of length `side`.
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0);
    const max = Math.max(...row), min = Math.min(...row);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  while (i < sizes.length) {
    const side = Math.min(w, h);
    const row = [sizes[i] * scale];
    let j = i + 1;
    while (j < sizes.length && worst([...row, sizes[j] * scale], side) <= worst(row, side)) { row.push(sizes[j] * scale); j++; }
    const sum = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      // A column on the left, as wide as its area over the height.
      const cw = sum / h;
      let cy = y;
      row.forEach((a, k) => { const rh = a / cw; out[i + k] = { x, y: cy, w: cw, h: rh }; cy += rh; });
      x += cw; w -= cw;
    } else {
      const rh = sum / w;
      let cx = x;
      row.forEach((a, k) => { const rw = a / rh; out[i + k] = { x: cx, y, w: rw, h: rh }; cx += rw; });
      y += rh; h -= rh;
    }
    i = j;
  }
  return out;
}
