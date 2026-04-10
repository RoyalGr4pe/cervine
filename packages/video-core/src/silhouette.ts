import type { Point } from "@repo/mesh-core";

/**
 * Morphological operations and silhouette extraction on a binary mask
 * (Uint8Array, 0 = background, 1 = foreground).
 */

// ---------------------------------------------------------------------------
// Morphological helpers
// ---------------------------------------------------------------------------

/**
 * Binary dilation: grow the foreground region by `radius` pixels.
 * Fills holes and bridges small gaps.
 */
export function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius = 3
): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hot = 0;
      outer: for (let dy = -radius; dy <= radius && !hot; dy++) {
        for (let dx = -radius; dx <= radius && !hot; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (mask[ny * width + nx]) hot = 1;
          }
        }
      }
      out[y * width + x] = hot;
    }
  }
  return out;
}

/**
 * Binary erosion: shrink the foreground region by `radius` pixels.
 * Removes noise pixels.
 */
export function erode(
  mask: Uint8Array,
  width: number,
  height: number,
  radius = 2
): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      let solid = 1;
      outer: for (let dy = -radius; dy <= radius && solid; dy++) {
        for (let dx = -radius; dx <= radius && solid; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            solid = 0;
          } else if (!mask[ny * width + nx]) {
            solid = 0;
          }
        }
      }
      out[y * width + x] = solid;
    }
  }
  return out;
}

/**
 * Morphological close = dilate then erode.
 * Fills holes inside the foreground silhouette.
 */
export function close(
  mask: Uint8Array,
  width: number,
  height: number,
  radius = 4
): Uint8Array {
  return erode(dilate(mask, width, height, radius), width, height, radius);
}

// ---------------------------------------------------------------------------
// Largest connected component
// ---------------------------------------------------------------------------

/**
 * Keeps only the largest foreground blob (removes noise islands).
 */
export function keepLargestBlob(
  mask: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const n = mask.length;
  const visited = new Uint8Array(n);
  let bestStart = -1;
  let bestSize = 0;

  const queue: number[] = [];

  for (let start = 0; start < n; start++) {
    if (!mask[start] || visited[start]) continue;

    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    let size = 0;
    let head = 0;

    while (head < queue.length) {
      const idx = queue[head++]!;
      size++;
      const px = idx % width;
      const py = (idx / width) | 0;

      if (px > 0          && mask[idx - 1]     && !visited[idx - 1])     { visited[idx - 1] = 1;     queue.push(idx - 1); }
      if (px < width - 1  && mask[idx + 1]     && !visited[idx + 1])     { visited[idx + 1] = 1;     queue.push(idx + 1); }
      if (py > 0          && mask[idx - width] && !visited[idx - width]) { visited[idx - width] = 1; queue.push(idx - width); }
      if (py < height - 1 && mask[idx + width] && !visited[idx + width]) { visited[idx + width] = 1; queue.push(idx + width); }
    }

    if (size > bestSize) {
      bestSize = size;
      bestStart = start;
    }
  }

  if (bestStart === -1) return new Uint8Array(n);

  // Re-flood from bestStart to build output mask
  const out = new Uint8Array(n);
  const vis2 = new Uint8Array(n);
  queue.length = 0;
  queue.push(bestStart);
  vis2[bestStart] = 1;
  let head = 0;

  while (head < queue.length) {
    const idx = queue[head++]!;
    out[idx] = 1;
    const px = idx % width;
    const py = (idx / width) | 0;

    if (px > 0          && mask[idx - 1]     && !vis2[idx - 1])     { vis2[idx - 1] = 1;     queue.push(idx - 1); }
    if (px < width - 1  && mask[idx + 1]     && !vis2[idx + 1])     { vis2[idx + 1] = 1;     queue.push(idx + 1); }
    if (py > 0          && mask[idx - width] && !vis2[idx - width]) { vis2[idx - width] = 1; queue.push(idx - width); }
    if (py < height - 1 && mask[idx + width] && !vis2[idx + width]) { vis2[idx + width] = 1; queue.push(idx + width); }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Contour extraction
// ---------------------------------------------------------------------------

/**
 * Finds all boundary pixels: foreground pixels with at least one background
 * neighbour (4-connected). Returns them as (x, y) pairs.
 */
function boundaryPixels(
  mask: Uint8Array,
  width: number,
  height: number
): Point[] {
  const pts: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const isBoundary =
        (x === 0 || !mask[y * width + (x - 1)]) ||
        (x === width - 1 || !mask[y * width + (x + 1)]) ||
        (y === 0 || !mask[(y - 1) * width + x]) ||
        (y === height - 1 || !mask[(y + 1) * width + x]);
      if (isBoundary) pts.push({ x, y });
    }
  }
  return pts;
}

/**
 * Evenly subsamples a set of points down to `target` count.
 * Uses a spatial grid to ensure even coverage rather than uniform index stride.
 */
function subsampleSpatially(points: Point[], target: number): Point[] {
  if (points.length <= target) return points;

  // Find bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const cellSize = Math.sqrt(((maxX - minX) * (maxY - minY)) / target);
  const cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cellSize));
  const grid = new Map<number, Point>();

  for (const p of points) {
    const col = Math.min(cols - 1, Math.floor((p.x - minX) / cellSize));
    const row = Math.min(rows - 1, Math.floor((p.y - minY) / cellSize));
    const key = row * cols + col;
    if (!grid.has(key)) grid.set(key, p);
  }

  return Array.from(grid.values());
}

// ---------------------------------------------------------------------------
// Interior scatter
// ---------------------------------------------------------------------------

/**
 * Returns up to `count` points sampled from the interior of the mask using a
 * deterministic grid scan (avoids random allocation).
 */
function interiorPoints(
  mask: Uint8Array,
  width: number,
  height: number,
  count: number
): Point[] {
  // Collect all interior pixels (foreground, no boundary)
  const interior: Point[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (
        mask[y * width + x] &&
        mask[(y - 1) * width + x] &&
        mask[(y + 1) * width + x] &&
        mask[y * width + (x - 1)] &&
        mask[y * width + (x + 1)]
      ) {
        interior.push({ x, y });
      }
    }
  }

  if (interior.length <= count) return interior;

  // Uniform stride subsample
  const step = Math.floor(interior.length / count);
  const result: Point[] = [];
  for (let i = 0; i < interior.length && result.length < count; i += step) {
    result.push(interior[i]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SilhouettePoints {
  /** Points along the silhouette contour */
  contour: Point[];
  /** Points scattered inside the silhouette */
  interior: Point[];
  /** The cleaned binary mask used to derive these points */
  mask: Uint8Array;
}

/**
 * Full silhouette extraction pipeline:
 *   mask → morphological close → largest blob → contour + interior points
 *
 * @param rawMask       Binary mask (1 = foreground) from BackgroundModel
 * @param width         Frame width
 * @param height        Frame height
 * @param contourCount  Target number of contour points (default 60)
 * @param interiorCount Target number of interior points (default 100)
 */
export function extractSilhouette(
  rawMask: Uint8Array,
  width: number,
  height: number,
  contourCount = 60,
  interiorCount = 100
): SilhouettePoints {
  // 1. Morphological close: fill holes, smooth edges
  const closed = close(rawMask, width, height, 5);

  // 2. Keep only the largest blob
  const blob = keepLargestBlob(closed, width, height);

  // 3. Contour: boundary pixels subsampled to contourCount
  const boundary = boundaryPixels(blob, width, height);
  const contour = subsampleSpatially(boundary, contourCount);

  // 4. Interior: evenly sampled points inside the blob
  const interior = interiorPoints(blob, width, height, interiorCount);

  return { contour, interior, mask: blob };
}
