import { Delaunay } from "d3-delaunay";
import type { Mesh, Point } from "./types";

/**
 * Builds a fixed Delaunay triangulation from the provided points.
 * Call this once after the initial frame dimensions are known.
 * The returned Mesh should be treated as immutable topology.
 */
export function generateMesh(points: Point[]): Mesh {
  if (points.length < 3) {
    throw new RangeError("generateMesh requires at least 3 points");
  }

  // d3-delaunay expects a flat [x0, y0, x1, y1, ...] Float64Array
  const coords = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) throw new Error(`Point at index ${i} is undefined`);
    coords[i * 2] = p.x;
    coords[i * 2 + 1] = p.y;
  }

  const delaunay = new Delaunay(coords);
  // delaunay.triangles is a Uint32Array of triplet indices
  const triangles = Array.from(delaunay.triangles) as number[];

  return { points, triangles };
}
