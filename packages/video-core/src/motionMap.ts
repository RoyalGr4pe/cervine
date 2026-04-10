export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Computes a per-pixel motion magnitude map between two frames.
 * Returns a Float32Array of length width*height, values in [0, 1].
 */
export function computeMotionMap(
  prevFrame: ImageData,
  nextFrame: ImageData
): Float32Array {
  const { width, height, data: prev } = prevFrame;
  const { data: next } = nextFrame;
  const map = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const dr = (prev[p] ?? 0) - (next[p] ?? 0);
    const dg = (prev[p + 1] ?? 0) - (next[p + 1] ?? 0);
    const db = (prev[p + 2] ?? 0) - (next[p + 2] ?? 0);
    // Euclidean colour distance normalised to [0,1]
    map[i] = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67; // 441.67 = sqrt(3*255^2)
  }

  return map;
}

/**
 * Smooths the motion map with a simple box blur to reduce noise.
 * Radius should be small (2–4 px).
 */
export function blurMotionMap(
  map: Float32Array,
  width: number,
  height: number,
  radius = 3
): Float32Array {
  const out = new Float32Array(map.length);
  const diam = 2 * radius + 1;

  // Horizontal pass
  const tmp = new Float32Array(map.length);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < diam; x++) sum += map[y * width + Math.min(x, width - 1)] ?? 0;
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / diam;
      const addX = Math.min(x + radius + 1, width - 1);
      const removeX = Math.max(x - radius, 0);
      sum += (map[y * width + addX] ?? 0) - (map[y * width + removeX] ?? 0);
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < diam; y++) sum += tmp[Math.min(y, height - 1) * width + x] ?? 0;
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / diam;
      const addY = Math.min(y + radius + 1, height - 1);
      const removeY = Math.max(y - radius, 0);
      sum += (tmp[addY * width + x] ?? 0) - (tmp[removeY * width + x] ?? 0);
    }
  }

  return out;
}

/**
 * Finds the bounding box of the largest contiguous blob of motion pixels.
 *
 * Strategy:
 *  1. Threshold the map to get a binary mask.
 *  2. Flood-fill (BFS) to find connected components.
 *  3. Return the bbox of the largest component.
 *
 * Falls back to the full frame if no blob is found.
 */
export function findObjectBounds(
  map: Float32Array,
  width: number,
  height: number,
  threshold = 0.04
): BoundingBox {
  const n = width * height;
  const visited = new Uint8Array(n);

  // Build binary mask
  const hot = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if ((map[i] ?? 0) >= threshold) hot[i] = 1;
  }

  let bestSize = 0;
  let bestBbox: BoundingBox = { x: 0, y: 0, w: width, h: height };

  const queue: number[] = [];

  for (let start = 0; start < n; start++) {
    if (!hot[start] || visited[start]) continue;

    // BFS
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;

    let minX = width, maxX = 0, minY = height, maxY = 0;
    let size = 0;
    let head = 0;

    while (head < queue.length) {
      const idx = queue[head++]!;
      const px = idx % width;
      const py = (idx / width) | 0;
      size++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      // 4-connected neighbours
      if (px > 0         && hot[idx - 1]     && !visited[idx - 1])     { visited[idx - 1] = 1;     queue.push(idx - 1); }
      if (px < width - 1 && hot[idx + 1]     && !visited[idx + 1])     { visited[idx + 1] = 1;     queue.push(idx + 1); }
      if (py > 0         && hot[idx - width] && !visited[idx - width]) { visited[idx - width] = 1; queue.push(idx - width); }
      if (py < height - 1 && hot[idx + width] && !visited[idx + width]) { visited[idx + width] = 1; queue.push(idx + width); }
    }

    if (size > bestSize) {
      bestSize = size;
      bestBbox = {
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
      };
    }
  }

  // If blob is tiny (< 0.5% of frame) fall back to full frame
  if (bestSize < n * 0.005) {
    return { x: 0, y: 0, w: width, h: height };
  }

  // Pad the bbox by 15% so the mesh isn't clipped at the silhouette edge
  const padX = Math.round(bestBbox.w * 0.15);
  const padY = Math.round(bestBbox.h * 0.15);
  return {
    x: Math.max(0, bestBbox.x - padX),
    y: Math.max(0, bestBbox.y - padY),
    w: Math.min(width - bestBbox.x + padX, bestBbox.w + padX * 2),
    h: Math.min(height - bestBbox.y + padY, bestBbox.h + padY * 2),
  };
}
