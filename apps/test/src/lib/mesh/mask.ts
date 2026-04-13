import type { Mask } from "@/lib/detect";

export type BinaryMask = {
    width: number;
    height: number;
    data: Uint8Array;
};

export function toBinaryMask(mask: Mask, threshold = 0.5): BinaryMask {
    const data = new Uint8Array(mask.width * mask.height);
    for (let i = 0; i < data.length; i += 1) {
        data[i] = mask.data[i] >= threshold ? 1 : 0;
    }
    return {
        width: mask.width,
        height: mask.height,
        data,
    };
}

export function maskArea(mask: BinaryMask): number {
    let area = 0;
    for (let i = 0; i < mask.data.length; i += 1) {
        area += mask.data[i] ? 1 : 0;
    }
    return area;
}

export function isInsideMask(mask: BinaryMask, x: number, y: number): boolean {
    const xi = Math.max(0, Math.min(mask.width - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(mask.height - 1, Math.round(y)));
    return mask.data[yi * mask.width + xi] === 1;
}

export function isBoundaryPixel(mask: BinaryMask, x: number, y: number): boolean {
    if (!isInsideMask(mask, x, y)) return false;
    if (x <= 0 || y <= 0 || x + 1 >= mask.width || y + 1 >= mask.height) return true;

    const base = y * mask.width + x;
    if (mask.data[base - 1] === 0) return true;
    if (mask.data[base + 1] === 0) return true;
    if (mask.data[base - mask.width] === 0) return true;
    if (mask.data[base + mask.width] === 0) return true;
    return false;
}
