import type { BBox, SeedPoint } from "./types";
import type { Mask } from "./types";
import { framePointToCropMask, isPointInsideMask, maskBoundingBox, normalizeBBox } from "./utils";

export function seedToCrop(
    seed: SeedPoint,
    frameWidth: number,
    frameHeight: number,
    fraction = 0.4,
): BBox {
    const side = Math.min(frameWidth, frameHeight) * fraction;
    const half = side / 2;
    return {
        x: Math.max(0, Math.min(frameWidth - side, seed.x - half)),
        y: Math.max(0, Math.min(frameHeight - side, seed.y - half)),
        w: side,
        h: side,
    };
}

export function validateSeedMask(seed: SeedPoint, crop: BBox, mask: Mask): boolean {
    const p = framePointToCropMask(seed.x, seed.y, crop, mask);
    return isPointInsideMask(mask, p.x, p.y, 0.15);
}

export function tightenCropFromMask(
    mask: Mask,
    crop: BBox,
    frameWidth: number,
    frameHeight: number,
    margin = 0.15,
): BBox | null {
    const inner = maskBoundingBox(mask, 0.25);
    if (!inner) return null;

    const x = crop.x + (inner.x / mask.width) * crop.w;
    const y = crop.y + (inner.y / mask.height) * crop.h;
    const w = (inner.w / mask.width) * crop.w;
    const h = (inner.h / mask.height) * crop.h;

    const expanded = {
        x: x - w * margin,
        y: y - h * margin,
        w: w * (1 + margin * 2),
        h: h * (1 + margin * 2),
    };

    return normalizeBBox(expanded, frameWidth, frameHeight);
}
