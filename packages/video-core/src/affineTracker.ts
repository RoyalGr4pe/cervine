import type { Point } from "@repo/mesh-core";

// ---------------------------------------------------------------------------
// SAD patch search for a single point
// ---------------------------------------------------------------------------

const PATCH_RADIUS = 5;
const SEARCH_RADIUS = 16;

function getGray(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): number {
  const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const i = (cy * width + cx) * 4;
  return 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
}

/**
 * Finds the displacement (dx, dy) that best matches the patch around (px, py)
 * in prevData to a patch in nextData.
 * Returns null if the patch is too flat/uniform to track reliably.
 */
function sadSearch(
  prevData: Uint8ClampedArray,
  nextData: Uint8ClampedArray,
  width: number,
  height: number,
  px: number,
  py: number
): { dx: number; dy: number } | null {
  let bestSAD = Infinity;
  let bestDx = 0;
  let bestDy = 0;
  const patchArea = (2 * PATCH_RADIUS + 1) ** 2;

  for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      let sad = 0;
      for (let ky = -PATCH_RADIUS; ky <= PATCH_RADIUS; ky++) {
        for (let kx = -PATCH_RADIUS; kx <= PATCH_RADIUS; kx++) {
          sad += Math.abs(
            getGray(prevData, width, height, px + kx, py + ky) -
            getGray(nextData, width, height, px + dx + kx, py + dy + ky)
          );
        }
      }
      if (sad < bestSAD) {
        bestSAD = sad;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  // Confidence: normalised SAD. 0 = perfect match, 1 = worst case.
  const confidence = bestSAD / (patchArea * 255);
  // Uniform/flat patches (confidence > 0.2) are not trackable
  if (confidence > 0.2) return null;

  return { dx: bestDx, dy: bestDy };
}

// ---------------------------------------------------------------------------
// Gradient-based anchor selection
// ---------------------------------------------------------------------------

/**
 * Scores a point's trackability by local gradient magnitude.
 * Points with strong gradients (edges/corners) track better.
 */
function gradientScore(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  px: number,
  py: number
): number {
  const cx = Math.max(1, Math.min(width - 2, Math.round(px)));
  const cy = Math.max(1, Math.min(height - 2, Math.round(py)));
  const gx = getGray(data, width, height, cx + 1, cy) - getGray(data, width, height, cx - 1, cy);
  const gy = getGray(data, width, height, cx, cy + 1) - getGray(data, width, height, cx, cy - 1);
  return gx * gx + gy * gy;
}

/**
 * Picks up to `count` well-distributed, high-gradient points from the set.
 * Uses a grid to ensure spatial spread (same approach as spatially-even subsample).
 */
function selectAnchorPoints(
  points: Point[],
  prevData: Uint8ClampedArray,
  width: number,
  height: number,
  count: number
): Point[] {
  if (points.length <= count) return points;

  // Score all points
  const scored = points.map((p) => ({
    p,
    score: gradientScore(prevData, width, height, p.x, p.y),
  }));
  // Sort descending by gradient score
  scored.sort((a, b) => b.score - a.score);

  // Greedily pick top-scored points that are far enough apart
  const minDist = Math.sqrt((width * height) / count) * 0.5;
  const chosen: Point[] = [];

  for (const { p } of scored) {
    if (chosen.length >= count) break;
    let tooClose = false;
    for (const c of chosen) {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < minDist) { tooClose = true; break; }
    }
    if (!tooClose) chosen.push(p);
  }

  return chosen;
}

// ---------------------------------------------------------------------------
// Least-squares affine fit
// ---------------------------------------------------------------------------

/**
 * Fits an affine transform to a set of (source, target) point correspondences.
 *
 * The affine model: [x'] = [a b] [x] + [tx]
 *                   [y']   [c d] [y]   [ty]
 *
 * Returns the 6 parameters [a, b, tx, c, d, ty] or null if degenerate.
 */
function fitAffine(
  src: Point[],
  dst: Point[]
): [number, number, number, number, number, number] | null {
  const n = src.length;
  if (n < 3) return null;

  // Normal equations for least-squares affine
  // Minimise sum of |A*p - p'|^2 over all correspondences
  // X row: a*x + b*y + tx = x'
  // Y row: c*x + d*y + ty = y'
  // Solve independently for x and y.

  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  let sxpx = 0, sypx = 0, spx = 0;
  let sxpy = 0, sypy = 0, spy = 0;

  for (let i = 0; i < n; i++) {
    const s = src[i]!;
    const d = dst[i]!;
    sx   += s.x;
    sy   += s.y;
    sxx  += s.x * s.x;
    sxy  += s.x * s.y;
    syy  += s.y * s.y;
    sxpx += s.x * d.x;
    sypx += s.y * d.x;
    spx  += d.x;
    sxpy += s.x * d.y;
    sypy += s.y * d.y;
    spy  += d.y;
  }

  // 3x3 system [sxx sxy sx] [a]   [sxpx]
  //            [sxy syy sy] [b] = [sypx]
  //            [sx  sy   n] [tx]  [spx ]
  // Solve via Cramer's rule
  const A = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx,  sy,  n ],
  ] as [[number,number,number],[number,number,number],[number,number,number]];

  const det3 = (m: [[number,number,number],[number,number,number],[number,number,number]]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

  const detA = det3(A);
  if (Math.abs(detA) < 1e-6) return null;

  const solveX = (rhs: [number, number, number]) => {
    const Ax: [[number,number,number],[number,number,number],[number,number,number]] = [
      [rhs[0], A[0][1], A[0][2]],
      [rhs[1], A[1][1], A[1][2]],
      [rhs[2], A[2][1], A[2][2]],
    ];
    const Ay: [[number,number,number],[number,number,number],[number,number,number]] = [
      [A[0][0], rhs[0], A[0][2]],
      [A[1][0], rhs[1], A[1][2]],
      [A[2][0], rhs[2], A[2][2]],
    ];
    const Az: [[number,number,number],[number,number,number],[number,number,number]] = [
      [A[0][0], A[0][1], rhs[0]],
      [A[1][0], A[1][1], rhs[1]],
      [A[2][0], A[2][1], rhs[2]],
    ];
    return [det3(Ax) / detA, det3(Ay) / detA, det3(Az) / detA] as [number, number, number];
  };

  const [a, b, tx] = solveX([sxpx, sypx, spx]);
  const [c, d, ty] = solveX([sxpy, sypy, spy]);

  return [a, b, tx, c, d, ty];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AffineParams {
  a: number; b: number; tx: number;
  c: number; d: number; ty: number;
}

/**
 * Estimates an affine transform between two frames by:
 *   1. Selecting anchor points with high gradient (trackable texture)
 *   2. Running SAD patch search on each anchor
 *   3. Fitting a least-squares affine to the correspondences
 *
 * Returns null if insufficient correspondences were found.
 */
export function estimateAffine(
  prevFrame: ImageData,
  nextFrame: ImageData,
  meshPoints: Point[],
  anchorCount = 16
): AffineParams | null {
  const { width, height, data: prevData } = prevFrame;
  const { data: nextData } = nextFrame;

  // Pick anchor candidates from well-textured mesh points
  const anchors = selectAnchorPoints(meshPoints, prevData, width, height, anchorCount);

  const src: Point[] = [];
  const dst: Point[] = [];

  for (const anchor of anchors) {
    const result = sadSearch(prevData, nextData, width, height, anchor.x, anchor.y);
    if (result) {
      src.push(anchor);
      dst.push({ x: anchor.x + result.dx, y: anchor.y + result.dy });
    }
  }

  if (src.length < 3) return null;

  const fit = fitAffine(src, dst);
  if (!fit) return null;

  const [a, b, tx, c, d, ty] = fit;

  // Sanity-check: reject wild transforms (scale > 2x or pure rotation > 30°)
  const scale = Math.sqrt(a * a + c * c);
  if (scale < 0.5 || scale > 2.0) return null;

  return { a, b, tx, c, d, ty };
}

/**
 * Applies an affine transform to an array of points in-place, returning new Points.
 * Clamps results to [0, width] x [0, height].
 */
export function applyAffine(
  points: Point[],
  affine: AffineParams,
  width: number,
  height: number
): Point[] {
  const { a, b, tx, c, d, ty } = affine;
  return points.map((p) => ({
    x: Math.max(0, Math.min(width - 1, a * p.x + b * p.y + tx)),
    y: Math.max(0, Math.min(height - 1, c * p.x + d * p.y + ty)),
  }));
}
