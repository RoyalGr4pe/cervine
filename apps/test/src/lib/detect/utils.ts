import type { BBox, FramePixels, Mask } from "./types";

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function normalizeBBox(bbox: BBox, frameWidth: number, frameHeight: number): BBox {
    const x = clamp(Math.round(bbox.x), 0, Math.max(0, frameWidth - 1));
    const y = clamp(Math.round(bbox.y), 0, Math.max(0, frameHeight - 1));
    const maxW = Math.max(1, frameWidth - x);
    const maxH = Math.max(1, frameHeight - y);
    const w = clamp(Math.round(bbox.w), 1, maxW);
    const h = clamp(Math.round(bbox.h), 1, maxH);
    return { x, y, w, h };
}

export function expandBBox(
    bbox: BBox,
    frameWidth: number,
    frameHeight: number,
    amount = 0.15,
): BBox {
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const w = bbox.w * (1 + amount * 2);
    const h = bbox.h * (1 + amount * 2);
    return normalizeBBox({ x: cx - w / 2, y: cy - h / 2, w, h }, frameWidth, frameHeight);
}

export function bboxArea(bbox: BBox): number {
    return bbox.w * bbox.h;
}

export function cropFramePixels(frame: FramePixels, bbox: BBox): FramePixels {
    const crop = normalizeBBox(bbox, frame.width, frame.height);
    const out = new Uint8ClampedArray(crop.w * crop.h * 4);
    for (let y = 0; y < crop.h; y += 1) {
        const srcY = crop.y + y;
        for (let x = 0; x < crop.w; x += 1) {
            const srcX = crop.x + x;
            const srcI = (srcY * frame.width + srcX) * 4;
            const dstI = (y * crop.w + x) * 4;
            out[dstI] = frame.data[srcI];
            out[dstI + 1] = frame.data[srcI + 1];
            out[dstI + 2] = frame.data[srcI + 2];
            out[dstI + 3] = frame.data[srcI + 3];
        }
    }
    return { data: out, width: crop.w, height: crop.h };
}

function sampleMaskBilinear(mask: Mask, x: number, y: number): number {
    const x0 = clamp(Math.floor(x), 0, mask.width - 1);
    const y0 = clamp(Math.floor(y), 0, mask.height - 1);
    const x1 = clamp(x0 + 1, 0, mask.width - 1);
    const y1 = clamp(y0 + 1, 0, mask.height - 1);
    const wx = x - x0;
    const wy = y - y0;

    const i00 = y0 * mask.width + x0;
    const i10 = y0 * mask.width + x1;
    const i01 = y1 * mask.width + x0;
    const i11 = y1 * mask.width + x1;

    const top = mask.data[i00] * (1 - wx) + mask.data[i10] * wx;
    const bottom = mask.data[i01] * (1 - wx) + mask.data[i11] * wx;
    return top * (1 - wy) + bottom * wy;
}

export function pasteMaskIntoFrame(
    cropMask: Mask,
    cropBBox: BBox,
    frameWidth: number,
    frameHeight: number,
): Mask {
    const full = new Float32Array(frameWidth * frameHeight);
    const crop = normalizeBBox(cropBBox, frameWidth, frameHeight);

    for (let y = 0; y < crop.h; y += 1) {
        const fy = crop.y + y;
        const sy = (y + 0.5) * (cropMask.height / crop.h) - 0.5;
        for (let x = 0; x < crop.w; x += 1) {
            const fx = crop.x + x;
            const sx = (x + 0.5) * (cropMask.width / crop.w) - 0.5;
            full[fy * frameWidth + fx] = sampleMaskBilinear(cropMask, sx, sy);
        }
    }

    return { data: full, width: frameWidth, height: frameHeight };
}

export function maskBoundingBox(mask: Mask, threshold = 0.5): BBox | null {
    let minX = mask.width;
    let minY = mask.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < mask.height; y += 1) {
        for (let x = 0; x < mask.width; x += 1) {
            if (mask.data[y * mask.width + x] >= threshold) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (maxX < minX || maxY < minY) return null;
    return {
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
    };
}

export function framePointToCropMask(
    pointX: number,
    pointY: number,
    cropBBox: BBox,
    mask: Mask,
): { x: number; y: number } {
    const localX = (pointX - cropBBox.x) / Math.max(cropBBox.w, 1);
    const localY = (pointY - cropBBox.y) / Math.max(cropBBox.h, 1);
    return {
        x: clamp(localX * mask.width, 0, mask.width - 1),
        y: clamp(localY * mask.height, 0, mask.height - 1),
    };
}

export function isPointInsideMask(mask: Mask, x: number, y: number, threshold = 0.15): boolean {
    const xi = clamp(Math.round(x), 0, mask.width - 1);
    const yi = clamp(Math.round(y), 0, mask.height - 1);
    return mask.data[yi * mask.width + xi] >= threshold;
}
