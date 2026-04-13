import type { BinaryMask } from "./mask";
import { isBoundaryPixel } from "./mask";

export type DetailMap = {
    width: number;
    height: number;
    distance: Float32Array;
    maxDistance: number;
};

export function buildDetailMap(mask: BinaryMask): DetailMap {
    const size = mask.width * mask.height;
    const distance = new Float32Array(size);
    const queueX = new Int32Array(size);
    const queueY = new Int32Array(size);
    let head = 0;
    let tail = 0;

    for (let i = 0; i < size; i += 1) {
        distance[i] = Number.POSITIVE_INFINITY;
    }

    for (let y = 0; y < mask.height; y += 1) {
        for (let x = 0; x < mask.width; x += 1) {
            const idx = y * mask.width + x;
            if (mask.data[idx] === 0) {
                distance[idx] = 0;
                continue;
            }
            if (!isBoundaryPixel(mask, x, y)) continue;
            distance[idx] = 0;
            queueX[tail] = x;
            queueY[tail] = y;
            tail += 1;
        }
    }

    const neighbors = [
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: -1 },
        { x: 0, y: 1 },
    ];

    while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head += 1;

        const current = distance[y * mask.width + x];
        for (const n of neighbors) {
            const nx = x + n.x;
            const ny = y + n.y;
            if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) continue;
            const ni = ny * mask.width + nx;
            if (mask.data[ni] === 0) continue;
            const nextDistance = current + 1;
            if (nextDistance >= distance[ni]) continue;
            distance[ni] = nextDistance;
            queueX[tail] = nx;
            queueY[tail] = ny;
            tail += 1;
        }
    }

    let maxDistance = 1;
    for (let i = 0; i < size; i += 1) {
        if (Number.isFinite(distance[i]) && distance[i] > maxDistance) {
            maxDistance = distance[i];
        }
    }

    return {
        width: mask.width,
        height: mask.height,
        distance,
        maxDistance,
    };
}
