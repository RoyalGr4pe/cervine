import type { Point } from "@repo/mesh-core";

const PATCH_RADIUS = 5;   // half-size of the comparison patch (pixels)
const SEARCH_RADIUS = 12; // max per-frame displacement to search (pixels)

/**
 * Tracks points between two consecutive frames using SAD patch search.
 *
 * Each point is only moved if:
 *  1. Its surrounding area shows meaningful motion (motionMap value above
 *     `motionThreshold`) — background points are held in place.
 *  2. The best SAD match is confident enough.
 *
 * @param prevFrame       RGBA ImageData from the previous frame
 * @param nextFrame       RGBA ImageData from the current frame
 * @param points          Points from the previous frame (image-pixel coords)
 * @param motionMap       Optional per-pixel motion magnitude [0,1].
 *                        When provided, points in static regions are clamped.
 * @param motionThreshold Points with local motion below this are not moved.
 */
export function trackPoints(
  prevFrame: ImageData,
  nextFrame: ImageData,
  points: Point[],
  motionMap?: Float32Array,
  motionThreshold = 0.03
): Point[] {
  const { width, height, data: prevData } = prevFrame;
  const { data: nextData } = nextFrame;

  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));

  const getGray = (data: Uint8ClampedArray, px: number, py: number): number => {
    const cx = clamp(Math.round(px), 0, width - 1);
    const cy = clamp(Math.round(py), 0, height - 1);
    const i = (cy * width + cx) * 4;
    return (
      0.299 * (data[i] ?? 0) +
      0.587 * (data[i + 1] ?? 0) +
      0.114 * (data[i + 2] ?? 0)
    );
  };

  /** Average motion map value in a small window around (px, py) */
  const localMotion = (px: number, py: number, r = PATCH_RADIUS): number => {
    if (!motionMap) return 1; // no map → always track
    let sum = 0;
    let count = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = clamp(Math.round(px + dx), 0, width - 1);
        const cy = clamp(Math.round(py + dy), 0, height - 1);
        sum += motionMap[cy * width + cx] ?? 0;
        count++;
      }
    }
    return sum / count;
  };

  return points.map((pt) => {
    // If this point's neighbourhood is static background, don't move it
    if (motionMap && localMotion(pt.x, pt.y) < motionThreshold) {
      return { ...pt };
    }

    let bestSAD = Infinity;
    let bestDx = 0;
    let bestDy = 0;

    for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
      for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
        let sad = 0;
        for (let py = -PATCH_RADIUS; py <= PATCH_RADIUS; py++) {
          for (let px = -PATCH_RADIUS; px <= PATCH_RADIUS; px++) {
            const prevG = getGray(prevData, pt.x + px, pt.y + py);
            const nextG = getGray(nextData, pt.x + dx + px, pt.y + dy + py);
            sad += Math.abs(prevG - nextG);
          }
        }
        if (sad < bestSAD) {
          bestSAD = sad;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }

    // Normalised SAD confidence: 0 = perfect match, 1 = worst case
    const patchArea = (2 * PATCH_RADIUS + 1) ** 2;
    const confidence = bestSAD / (patchArea * 255);

    // Low confidence (flat/uniform patch) → don't move
    if (confidence > 0.25) return { ...pt };

    return {
      x: clamp(pt.x + bestDx, 0, width - 1),
      y: clamp(pt.y + bestDy, 0, height - 1),
    };
  });
}
