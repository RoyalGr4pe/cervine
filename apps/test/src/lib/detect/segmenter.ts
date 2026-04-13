import type { BBox, FramePixels, Mask } from "./types";
import { clamp, cropFramePixels, normalizeBBox } from "./utils";

export type SegmentOptions = {
    targetSize?: number;
};

function estimateBorderColor(data: Uint8ClampedArray, width: number, height: number): { r: number; g: number; b: number } {
    const border = Math.max(2, Math.floor(Math.min(width, height) * 0.08));
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const isBorder = x < border || y < border || x >= width - border || y >= height - border;
            if (!isBorder) continue;
            const i = (y * width + x) * 4;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count += 1;
        }
    }

    if (count === 0) return { r: 0, g: 0, b: 0 };
    return {
        r: r / count,
        g: g / count,
        b: b / count,
    };
}

function sampleNearest(
    data: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    x: number,
    y: number,
): { r: number; g: number; b: number; a: number } {
    const sx = clamp(Math.round(x), 0, srcWidth - 1);
    const sy = clamp(Math.round(y), 0, srcHeight - 1);
    const i = (sy * srcWidth + sx) * 4;
    return {
        r: data[i],
        g: data[i + 1],
        b: data[i + 2],
        a: data[i + 3],
    };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    if (edge0 === edge1) return x < edge0 ? 0 : 1;
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

export async function segment(
    frame: FramePixels,
    crop: BBox,
    options: SegmentOptions = {},
): Promise<Mask | null> {
    // This is a deterministic fallback matte that mirrors the BiRefNet flow:
    // crop → resize to model-size square → soft alpha output.
    const targetSize = options.targetSize ?? 512;
    const normalizedCrop = normalizeBBox(crop, frame.width, frame.height);
    const cropPixels = cropFramePixels(frame, normalizedCrop);

    const outW = Math.max(32, targetSize);
    const outH = Math.max(32, targetSize);
    const resized = new Uint8ClampedArray(outW * outH * 4);

    for (let y = 0; y < outH; y += 1) {
        const sy = (y + 0.5) * (cropPixels.height / outH) - 0.5;
        for (let x = 0; x < outW; x += 1) {
            const sx = (x + 0.5) * (cropPixels.width / outW) - 0.5;
            const p = sampleNearest(cropPixels.data, cropPixels.width, cropPixels.height, sx, sy);
            const i = (y * outW + x) * 4;
            resized[i] = p.r;
            resized[i + 1] = p.g;
            resized[i + 2] = p.b;
            resized[i + 3] = p.a;
        }
    }

    const bg = estimateBorderColor(resized, outW, outH);
    const score = new Float32Array(outW * outH);
    let sum = 0;
    let sumSq = 0;

    for (let y = 0; y < outH; y += 1) {
        for (let x = 0; x < outW; x += 1) {
            const i = (y * outW + x) * 4;
            const dr = resized[i] - bg.r;
            const dg = resized[i + 1] - bg.g;
            const db = resized[i + 2] - bg.b;
            const diffNorm = Math.sqrt(dr * dr + dg * dg + db * db) / 441.673;

            const nx = x / Math.max(outW - 1, 1);
            const ny = y / Math.max(outH - 1, 1);
            const dx = nx - 0.5;
            const dy = ny - 0.5;
            const centerPrior = Math.exp(-(dx * dx + dy * dy) / 0.18);

            const pixelScore = diffNorm * 0.82 + centerPrior * 0.18;
            const idx = y * outW + x;
            score[idx] = pixelScore;
            sum += pixelScore;
            sumSq += pixelScore * pixelScore;
        }
    }

    const count = outW * outH;
    const mean = sum / count;
    const variance = Math.max(0, sumSq / count - mean * mean);
    const std = Math.sqrt(variance);
    const threshold = mean + std * 0.35;
    const band = Math.max(std * 0.7, 0.04);

    const data = new Float32Array(outW * outH);
    let alphaSum = 0;
    for (let i = 0; i < score.length; i += 1) {
        const alpha = smoothstep(threshold - band, threshold + band, score[i]);
        data[i] = alpha;
        alphaSum += alpha;
    }

    if (alphaSum / count < 0.015) return null;
    return {
        data,
        width: outW,
        height: outH,
    };
}
