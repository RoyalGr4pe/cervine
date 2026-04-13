import type { Point } from "@repo/mesh-core";

// ---------------------------------------------------------------------------
// Step 1: Sample background colour from frame border
// ---------------------------------------------------------------------------

export function sampleBorderColor(
    frame: ImageData,
    borderWidth = 8
): { r: number; g: number; b: number } {
    const { width, height, data } = frame;
    let r = 0, g = 0, b = 0, count = 0;

    const add = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        r += data[i] ?? 0;
        g += data[i + 1] ?? 0;
        b += data[i + 2] ?? 0;
        count++;
    };

    for (let bw = 0; bw < borderWidth; bw++) {
        for (let x = 0; x < width; x++) {
            add(x, bw);
            add(x, height - 1 - bw);
        }
        for (let y = borderWidth; y < height - borderWidth; y++) {
            add(bw, y);
            add(width - 1 - bw, y);
        }
    }

    return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
}

// ---------------------------------------------------------------------------
// Step 2: Foreground mask — squared distance, no sqrt
// ---------------------------------------------------------------------------

export function buildForegroundMask(
    frame: ImageData,
    bg: { r: number; g: number; b: number },
    threshold = 60,
    previousFrame?: ImageData | null
): Uint8Array {
    const { width, height, data } = frame;
    const n = width * height;
    const mask = new Uint8Array(n);
    const thresh2 = threshold * threshold;
    const bgSum = bg.r + bg.g + bg.b + 1;
    const bgRN = bg.r / bgSum;
    const bgBN = bg.b / bgSum;

    const prev = previousFrame?.data;

    for (let i = 0; i < n; i++) {
        const p = i * 4;
        const r = data[p] ?? 0;
        const g = data[p + 1] ?? 0;
        const b = data[p + 2] ?? 0;

        const dr = r - bg.r;
        const dg = g - bg.g;
        const db = b - bg.b;
        const rgb2 = dr * dr + dg * dg + db * db;

        const sum = r + g + b + 1;
        const rn = r / sum;
        const bn = b / sum;
        const dRn = rn - bgRN;
        const dBn = bn - bgBN;
        const chroma2 = (dRn * dRn + dBn * dBn) * 255 * 255;

        const score = rgb2 + chroma2 * 0.6;
        let isFg = score > thresh2;

        if (!isFg && prev) {
            const pr = prev[p] ?? 0;
            const pg = prev[p + 1] ?? 0;
            const pb = prev[p + 2] ?? 0;
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            const prevLuma = 0.299 * pr + 0.587 * pg + 0.114 * pb;
            const motion = Math.abs(luma - prevLuma);
            if (motion > Math.max(12, threshold * 0.28) && score > thresh2 * 0.45) {
                isFg = true;
            }
        }

        mask[i] = isFg ? 1 : 0;
    }

    return mask;
}

// ---------------------------------------------------------------------------
// Step 3: Fast morphological close via separable 1D prefix sums
//
// Traditional dilate/erode with radius r costs O(W*H*r²).
// Separable approach: two 1D passes (horizontal then vertical) costs O(W*H*r)
// but we can do even better with prefix sums: O(W*H) regardless of r.
//
// Dilation with a square structuring element: a pixel is 1 if the sum of any
// row or column window of width (2r+1) centred on it contains a 1.
// We implement this as: sum > 0 in the window → dilated.
// Erosion: sum == (2r+1)² → eroded (all neighbours are 1).
// ---------------------------------------------------------------------------

function integralRow(
    src: Uint8Array,
    width: number,
    height: number,
    radius: number
): Uint8Array {
    // Horizontal prefix-sum dilation: dst[y][x] = 1 if any src[y][x-r..x+r] = 1
    const dst = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
        const row = y * width;
        // Running window sum
        let sum = 0;
        // Seed the first window
        for (let x = 0; x <= Math.min(radius, width - 1); x++) sum += src[row + x] ?? 0;
        for (let x = 0; x < width; x++) {
            const addX = x + radius + 1;
            const remX = x - radius - 1;
            if (addX < width) sum += src[row + addX] ?? 0;
            if (remX >= 0) sum -= src[row + remX] ?? 0;
            dst[row + x] = sum > 0 ? 1 : 0;
        }
    }
    return dst;
}

function integralCol(
    src: Uint8Array,
    width: number,
    height: number,
    radius: number,
    erode: boolean
): Uint8Array {
    const dst = new Uint8Array(src.length);
    const full = erode ? (2 * radius + 1) : 1; // erosion needs full window filled
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let y = 0; y <= Math.min(radius, height - 1); y++) sum += src[y * width + x] ?? 0;
        for (let y = 0; y < height; y++) {
            const addY = y + radius + 1;
            const remY = y - radius - 1;
            if (addY < height) sum += src[addY * width + x] ?? 0;
            if (remY >= 0) sum -= src[remY * width + x] ?? 0;
            dst[y * width + x] = erode ? (sum >= full ? 1 : 0) : (sum > 0 ? 1 : 0);
        }
    }
    return dst;
}

function dilateFast(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
    return integralCol(integralRow(mask, width, height, radius), width, height, radius, false);
}

function erodeFast(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
    // For erosion we need all pixels in the (2r+1)×(2r+1) window to be 1.
    // Two separable passes: horizontal then vertical, each checking the full window.
    const hPass = new Uint8Array(mask.length);
    const hFull = 2 * radius + 1;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        let sum = 0;
        for (let x = 0; x <= Math.min(radius, width - 1); x++) sum += mask[row + x] ?? 0;
        for (let x = 0; x < width; x++) {
            const addX = x + radius + 1;
            const remX = x - radius - 1;
            if (addX < width) sum += mask[row + addX] ?? 0;
            if (remX >= 0) sum -= mask[row + remX] ?? 0;
            hPass[row + x] = sum >= hFull ? 1 : 0;
        }
    }
    return integralCol(hPass, width, height, radius, true);
}

export function closeMask(
    mask: Uint8Array,
    width: number,
    height: number,
    radius = 6
): Uint8Array {
    return erodeFast(dilateFast(mask, width, height, radius), width, height, radius);
}

// ---------------------------------------------------------------------------
// Step 4: Keep largest blob — avoids JS array per blob
// ---------------------------------------------------------------------------

export function keepLargestBlob(
    mask: Uint8Array,
    width: number,
    height: number
): Uint8Array {
    const n = mask.length;
    // label array: 0=unvisited, 1=bg-or-visited
    const label = new Uint8Array(n);
    const queue = new Int32Array(n); // pre-allocated, no GC
    let bestStart = -1;
    let bestSize = 0;

    for (let start = 0; start < n; start++) {
        if (!mask[start] || label[start]) continue;

        let head = 0, tail = 0, size = 0;
        queue[tail++] = start;
        label[start] = 1;

        while (head < tail) {
            const idx = queue[head++]!;
            size++;
            const px = idx % width;
            const py = (idx / width) | 0;
            if (px > 0 && mask[idx - 1] && !label[idx - 1]) { label[idx - 1] = 1; queue[tail++] = idx - 1; }
            if (px < width - 1 && mask[idx + 1] && !label[idx + 1]) { label[idx + 1] = 1; queue[tail++] = idx + 1; }
            if (py > 0 && mask[idx - width] && !label[idx - width]) { label[idx - width] = 1; queue[tail++] = idx - width; }
            if (py < height - 1 && mask[idx + width] && !label[idx + width]) { label[idx + width] = 1; queue[tail++] = idx + width; }
        }

        if (size > bestSize) { bestSize = size; bestStart = start; }
    }

    if (bestStart === -1) return new Uint8Array(n);

    // Re-flood from bestStart
    const out = new Uint8Array(n);
    const vis = new Uint8Array(n);
    let head = 0, tail = 0;
    queue[tail++] = bestStart;
    vis[bestStart] = 1;

    while (head < tail) {
        const idx = queue[head++]!;
        out[idx] = 1;
        const px = idx % width;
        const py = (idx / width) | 0;
        if (px > 0 && mask[idx - 1] && !vis[idx - 1]) { vis[idx - 1] = 1; queue[tail++] = idx - 1; }
        if (px < width - 1 && mask[idx + 1] && !vis[idx + 1]) { vis[idx + 1] = 1; queue[tail++] = idx + 1; }
        if (py > 0 && mask[idx - width] && !vis[idx - width]) { vis[idx - width] = 1; queue[tail++] = idx - width; }
        if (py < height - 1 && mask[idx + width] && !vis[idx + width]) { vis[idx + width] = 1; queue[tail++] = idx + width; }
    }

    return out;
}

// ---------------------------------------------------------------------------
// Step 5: Contour trace (only needed for preview, skipped during processing)
// ---------------------------------------------------------------------------

export function traceContour(mask: Uint8Array, width: number, height: number): Point[] {
    const boundary: Point[] = [];
    let cx = 0, cy = 0, count = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!mask[y * width + x]) continue;
            const onBoundary =
                x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
                !mask[y * width + (x - 1)] || !mask[y * width + (x + 1)] ||
                !mask[(y - 1) * width + x] || !mask[(y + 1) * width + x];
            if (onBoundary) { boundary.push({ x, y }); cx += x; cy += y; count++; }
        }
    }

    if (!count) return [];
    cx /= count; cy /= count;
    boundary.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    return boundary;
}

export function subsampleContour(contour: Point[], targetCount: number): Point[] {
    if (contour.length <= targetCount) return contour;
    const step = contour.length / targetCount;
    const result: Point[] = [];
    for (let i = 0; i < targetCount; i++) result.push(contour[Math.round(i * step) % contour.length]!);
    return result;
}

// ---------------------------------------------------------------------------
// Public API — two variants
// ---------------------------------------------------------------------------

export interface DetectedObject {
    contour: Point[];
    meshContour: Point[];
    mask: Uint8Array;
    centroid: { x: number; y: number };
    bbox: { x: number; y: number; w: number; h: number };
}

/**
 * Full detection pipeline including contour trace. Use for the live preview.
 */
export function detectObject(
    frame: ImageData,
    threshold = 60,
    meshPointCount = 80
): DetectedObject | null {
    const { width, height } = frame;
    const bg = sampleBorderColor(frame);
    const raw = buildForegroundMask(frame, bg, threshold);
    const closed = closeMask(raw, width, height, 6);
    const blob = keepLargestBlob(closed, width, height);

    let blobSize = 0;
    for (let i = 0; i < blob.length; i++) if (blob[i]) blobSize++;
    if (blobSize < width * height * 0.005) return null;

    const contour = traceContour(blob, width, height);
    if (contour.length < 6) return null;
    const meshContour = subsampleContour(contour, meshPointCount);

    let minX = width, maxX = 0, minY = height, maxY = 0, sumX = 0, sumY = 0, cnt = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!blob[y * width + x]) continue;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            sumX += x; sumY += y; cnt++;
        }
    }

    return {
        contour, meshContour, mask: blob,
        centroid: { x: sumX / cnt, y: sumY / cnt },
        bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    };
}

/**
 * Fast variant for batch processing — skips contour trace and blob filtering.
 * Returns just the mask and centroid, which is all processVideo needs.
 */
export function detectObjectFast(
    frame: ImageData,
    bg: { r: number; g: number; b: number },
    threshold = 60,
    previousFrame?: ImageData | null
): { mask: Uint8Array; centroid: { x: number; y: number } } | null {
    const { width, height } = frame;
    const raw = buildForegroundMask(frame, bg, threshold, previousFrame);
    const closed = closeMask(raw, width, height, 6);
    const blob = keepLargestBlob(closed, width, height);

    let sumX = 0, sumY = 0, cnt = 0;
    for (let i = 0; i < blob.length; i++) {
        if (!blob[i]) continue;
        sumX += i % width;
        sumY += (i / width) | 0;
        cnt++;
    }

    if (cnt < width * height * 0.005) return null;
    return { mask: blob, centroid: { x: sumX / cnt, y: sumY / cnt } };
}
