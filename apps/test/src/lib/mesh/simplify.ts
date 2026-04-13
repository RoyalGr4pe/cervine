import type { Point } from "./marchingSquares";

function perpendicularDistance(point: Point, start: Point, end: Point): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) {
        return Math.hypot(point.x - start.x, point.y - start.y);
    }

    const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
    const px = start.x + t * dx;
    const py = start.y + t * dy;
    return Math.hypot(point.x - px, point.y - py);
}

function polygonPerimeter(points: Point[]): number {
    if (points.length < 2) return 0;
    let perimeter = 0;
    for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return perimeter;
}

export function simplifyOutline(points: Point[]): Point[] {
    if (points.length <= 16) return points;

    const perimeter = polygonPerimeter(points);
    const epsilon = Math.max(0.8, perimeter / 400);

    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;

    const stack: Array<{ start: number; end: number }> = [{ start: 0, end: points.length - 1 }];

    while (stack.length > 0) {
        const range = stack.pop();
        if (!range) continue;

        let bestIndex = -1;
        let bestDistance = 0;
        for (let i = range.start + 1; i < range.end; i += 1) {
            const d = perpendicularDistance(points[i], points[range.start], points[range.end]);
            if (d > bestDistance) {
                bestDistance = d;
                bestIndex = i;
            }
        }

        if (bestIndex >= 0 && bestDistance > epsilon) {
            keep[bestIndex] = 1;
            stack.push({ start: range.start, end: bestIndex });
            stack.push({ start: bestIndex, end: range.end });
        }
    }

    const out: Point[] = [];
    for (let i = 0; i < points.length; i += 1) {
        if (keep[i]) out.push(points[i]);
    }

    return out.length >= 3 ? out : points;
}
