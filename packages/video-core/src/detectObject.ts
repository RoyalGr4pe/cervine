import type { Point } from "@repo/mesh-core";

// ---------------------------------------------------------------------------
// Step 1: Sample background colour from frame border
// ---------------------------------------------------------------------------

/**
 * Estimates the background colour by averaging pixels along the frame border
 * (top/bottom rows, left/right columns). Works well when the subject doesn't
 * touch the frame edge — which is the common case for a bird in flight.
 *
 * Returns { r, g, b } average.
 */
export function sampleBorderColor(
  frame: ImageData,
  borderWidth = 8
): { r: number; g: number; b: number } {
  const { width, height, data } = frame;
  let r = 0, g = 0, b = 0, count = 0;

  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    r += data[i]     ?? 0;
    g += data[i + 1] ?? 0;
    b += data[i + 2] ?? 0;
    count++;
  };

  for (let bw = 0; bw < borderWidth; bw++) {
    for (let x = 0; x < width; x++) {
      add(x, bw);               // top rows
      add(x, height - 1 - bw); // bottom rows
    }
    for (let y = borderWidth; y < height - borderWidth; y++) {
      add(bw, y);               // left cols
      add(width - 1 - bw, y);  // right cols
    }
  }

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

// ---------------------------------------------------------------------------
// Step 2: Build foreground mask by colour distance from background
// ---------------------------------------------------------------------------

/**
 * Builds a binary mask (Uint8Array, 1 = foreground) by comparing each pixel
 * to the background colour. Uses Euclidean RGB distance.
 *
 * @param threshold  Distance threshold (0–441). ~40–80 works well for
 *                   a dark bird against a bright/uniform sky.
 */
export function buildForegroundMask(
  frame: ImageData,
  bg: { r: number; g: number; b: number },
  threshold = 60
): Uint8Array {
  const { width, height, data } = frame;
  const n = width * height;
  const mask = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const dr = (data[p]     ?? 0) - bg.r;
    const dg = (data[p + 1] ?? 0) - bg.g;
    const db = (data[p + 2] ?? 0) - bg.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    mask[i] = dist > threshold ? 1 : 0;
  }

  return mask;
}

// ---------------------------------------------------------------------------
// Step 3: Morphological operations to clean the mask
// ---------------------------------------------------------------------------

function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hot = 0;
      for (let dy = -radius; dy <= radius && !hot; dy++) {
        for (let dx = -radius; dx <= radius && !hot; dx++) {
          const nx = x + dx, ny = y + dy;
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

function erode(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      let solid = 1;
      for (let dy = -radius; dy <= radius && solid; dy++) {
        for (let dx = -radius; dx <= radius && solid; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || !mask[ny * width + nx]) {
            solid = 0;
          }
        }
      }
      out[y * width + x] = solid;
    }
  }
  return out;
}

/** Morphological close: fills holes inside the object. */
export function closeMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius = 6
): Uint8Array {
  return erode(dilate(mask, width, height, radius), width, height, radius);
}

// ---------------------------------------------------------------------------
// Step 4: Keep only the largest connected blob
// ---------------------------------------------------------------------------

export function keepLargestBlob(
  mask: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const n = mask.length;
  const visited = new Uint8Array(n);
  const queue: number[] = [];
  let bestPixels: number[] = [];

  for (let start = 0; start < n; start++) {
    if (!mask[start] || visited[start]) continue;

    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    const pixels: number[] = [];
    let head = 0;

    while (head < queue.length) {
      const idx = queue[head++]!;
      pixels.push(idx);
      const px = idx % width;
      const py = (idx / width) | 0;
      const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
      const checks   = [px > 0, px < width - 1, py > 0, py < height - 1];
      for (let k = 0; k < 4; k++) {
        const ni = neighbors[k]!;
        if (checks[k] && mask[ni] && !visited[ni]) {
          visited[ni] = 1;
          queue.push(ni);
        }
      }
    }

    if (pixels.length > bestPixels.length) bestPixels = pixels;
  }

  const out = new Uint8Array(n);
  for (const idx of bestPixels) out[idx] = 1;
  return out;
}

// ---------------------------------------------------------------------------
// Step 5: Contour tracing (Moore neighbourhood / square tracing)
// ---------------------------------------------------------------------------

/**
 * Traces the outer boundary of the largest foreground blob using a
 * simple boundary-pixel scan: collects all pixels where at least one
 * 4-connected neighbour is background, then orders them by angle from
 * centroid for a clean polygon.
 */
export function traceContour(
  mask: Uint8Array,
  width: number,
  height: number
): Point[] {
  // Collect all boundary pixels
  const boundary: Point[] = [];
  let cx = 0, cy = 0, count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const onBoundary =
        x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
        !mask[y * width + (x - 1)] ||
        !mask[y * width + (x + 1)] ||
        !mask[(y - 1) * width + x] ||
        !mask[(y + 1) * width + x];
      if (onBoundary) {
        boundary.push({ x, y });
        cx += x; cy += y; count++;
      }
    }
  }

  if (boundary.length === 0) return [];

  // Centroid of boundary pixels
  cx = cx / count;
  cy = cy / count;

  // Sort by angle from centroid → ordered polygon
  boundary.sort((a, b) => {
    const angleA = Math.atan2(a.y - cy, a.x - cx);
    const angleB = Math.atan2(b.y - cy, b.x - cx);
    return angleA - angleB;
  });

  return boundary;
}

// ---------------------------------------------------------------------------
// Step 6: Subsample contour to a manageable point count
// ---------------------------------------------------------------------------

/**
 * Reduces a contour to `targetCount` evenly-spaced points by index stride.
 */
export function subsampleContour(contour: Point[], targetCount: number): Point[] {
  if (contour.length <= targetCount) return contour;
  const step = contour.length / targetCount;
  const result: Point[] = [];
  for (let i = 0; i < targetCount; i++) {
    const idx = Math.round(i * step) % contour.length;
    result.push(contour[idx]!);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface DetectedObject {
  /** Full ordered contour (may be large) */
  contour: Point[];
  /** Subsampled contour suitable for mesh triangulation */
  meshContour: Point[];
  /** The cleaned binary mask */
  mask: Uint8Array;
  /** Centroid of the object */
  centroid: { x: number; y: number };
  /** Tight bounding box */
  bbox: { x: number; y: number; w: number; h: number };
}

/**
 * Full detection pipeline on a single frame:
 *   border colour → foreground mask → close → largest blob → contour
 *
 * @param frame          The video frame (from extractFrame)
 * @param threshold      Colour distance threshold (try 50–80)
 * @param meshPointCount How many contour points to keep for the mesh
 */
export function detectObject(
  frame: ImageData,
  threshold = 60,
  meshPointCount = 80
): DetectedObject | null {
  const { width, height } = frame;

  const bg   = sampleBorderColor(frame);
  const raw  = buildForegroundMask(frame, bg, threshold);
  const closed = closeMask(raw, width, height, 6);
  const blob = keepLargestBlob(closed, width, height);

  // Check blob is substantial (>0.5% of frame)
  let blobSize = 0;
  for (let i = 0; i < blob.length; i++) if (blob[i]) blobSize++;
  if (blobSize < width * height * 0.005) return null;

  const contour = traceContour(blob, width, height);
  if (contour.length < 6) return null;

  const meshContour = subsampleContour(contour, meshPointCount);

  // Compute centroid and bbox from blob
  let minX = width, maxX = 0, minY = height, maxY = 0;
  let sumX = 0, sumY = 0, cnt = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!blob[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sumX += x; sumY += y; cnt++;
    }
  }

  return {
    contour,
    meshContour,
    mask: blob,
    centroid: { x: sumX / cnt, y: sumY / cnt },
    bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}
