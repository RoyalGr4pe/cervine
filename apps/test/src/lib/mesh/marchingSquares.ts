import { isBoundaryPixel } from "./mask";
import type { BinaryMask } from "./mask";

export type Point = { x: number; y: number };

const DIRS = [
    { x: -1, y: 0 },
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: -1, y: 1 },
];

function findStart(mask: BinaryMask): { x: number; y: number } | null {
    for (let y = 0; y < mask.height; y += 1) {
        for (let x = 0; x < mask.width; x += 1) {
            if (isBoundaryPixel(mask, x, y)) {
                return { x, y };
            }
        }
    }
    return null;
}

function directionIndex(dx: number, dy: number): number {
    for (let i = 0; i < DIRS.length; i += 1) {
        if (DIRS[i].x === dx && DIRS[i].y === dy) return i;
    }
    return 0;
}

export function extractOutline(mask: BinaryMask): Point[] {
    const start = findStart(mask);
    if (!start) return [];

    const points: Point[] = [];
    let current = { ...start };
    let previous = { x: start.x - 1, y: start.y };
    const maxSteps = mask.width * mask.height * 4;

    for (let step = 0; step < maxSteps; step += 1) {
        points.push({ x: current.x + 0.5, y: current.y + 0.5 });

        const backDx = previous.x - current.x;
        const backDy = previous.y - current.y;
        const startDir = directionIndex(backDx, backDy);

        let foundNext = false;
        for (let k = 0; k < DIRS.length; k += 1) {
            const dir = DIRS[(startDir + 1 + k) % DIRS.length];
            const nx = current.x + dir.x;
            const ny = current.y + dir.y;
            if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) continue;
            if (!isBoundaryPixel(mask, nx, ny)) continue;

            previous = current;
            current = { x: nx, y: ny };
            foundNext = true;
            break;
        }

        if (!foundNext) break;
        if (current.x === start.x && current.y === start.y) break;
    }

    if (points.length < 3) return [];
    return points;
}
