import type { Point } from "./types";

export interface PointBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Generates points for Delaunay triangulation from a silhouette.
 *
 * Combines contour points (the object's edge) with interior scatter points
 * (filling the object body). No far-field corner anchors — the mesh covers
 * only the object, not the whole frame.
 *
 * Falls back to a simple uniform grid when no silhouette is provided.
 *
 * @param width     Frame width (used for fallback grid only)
 * @param height    Frame height (used for fallback grid only)
 * @param contour   Points along the silhouette boundary
 * @param interior  Points scattered inside the silhouette
 */
export function generatePoints(
  width: number,
  height: number,
  contour?: Point[],
  interior?: Point[]
): Point[] {
  if (contour && contour.length >= 3) {
    // Deduplicate and combine
    const seen = new Set<string>();
    const pts: Point[] = [];
    const add = (p: Point) => {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) return;
      seen.add(key);
      pts.push(p);
    };
    for (const p of contour) add(p);
    if (interior) for (const p of interior) add(p);
    return pts;
  }

  // Fallback: uniform grid over the full frame
  const density = 14;
  const cols = density;
  const rows = Math.max(2, Math.round((density * height) / width));
  const seen = new Set<string>();
  const pts: Point[] = [];
  const add = (x: number, y: number) => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const key = `${rx},${ry}`;
    if (seen.has(key)) return;
    seen.add(key);
    pts.push({ x: rx, y: ry });
  };
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      add((c / cols) * width, (r / rows) * height);
    }
  }
  return pts;
}
