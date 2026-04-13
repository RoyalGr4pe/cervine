import { isInsideMask, maskArea } from "./mask";
import type { BinaryMask } from "./mask";
import type { DetailMap } from "./detailMap";
import type { Point } from "./marchingSquares";

export type MeshDensity = "low" | "medium" | "high";

type SamplePoint = Point & { radius: number };

function targetCountForDensity(density: MeshDensity): number {
    if (density === "low") return 120;
    if (density === "high") return 360;
    return 240;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function distanceNorm(detail: DetailMap, x: number, y: number): number {
    const xi = clamp(Math.round(x), 0, detail.width - 1);
    const yi = clamp(Math.round(y), 0, detail.height - 1);
    const value = detail.distance[yi * detail.width + xi];
    return clamp(value / Math.max(1, detail.maxDistance), 0, 1);
}

export function sampleInteriorPoints(
    mask: BinaryMask,
    detail: DetailMap,
    density: MeshDensity,
    outline: Point[],
): Point[] {
    const area = Math.max(1, maskArea(mask));
    const target = targetCountForDensity(density);
    const baseRadius = Math.max(2.5, Math.sqrt(area / target) * 0.95);
    const maxTries = target * 60;

    const points: SamplePoint[] = [];
    const outlinePoints = outline.map((p) => ({ x: p.x, y: p.y, radius: baseRadius * 0.55 }));

    for (let t = 0; t < maxTries; t += 1) {
        if (points.length >= target) break;
        const x = Math.random() * (mask.width - 1);
        const y = Math.random() * (mask.height - 1);
        if (!isInsideMask(mask, x, y)) continue;

        const norm = distanceNorm(detail, x, y);
        const radius = baseRadius * (0.55 + norm * 1.25);

        let ok = true;
        for (const existing of points) {
            const dx = x - existing.x;
            const dy = y - existing.y;
            const minRadius = Math.min(radius, existing.radius);
            if (dx * dx + dy * dy < minRadius * minRadius) {
                ok = false;
                break;
            }
        }
        if (!ok) continue;

        for (const existing of outlinePoints) {
            const dx = x - existing.x;
            const dy = y - existing.y;
            const minRadius = Math.min(radius, existing.radius);
            if (dx * dx + dy * dy < minRadius * minRadius) {
                ok = false;
                break;
            }
        }
        if (!ok) continue;

        points.push({ x, y, radius });
    }

    return points.map((p) => ({ x: p.x, y: p.y }));
}
