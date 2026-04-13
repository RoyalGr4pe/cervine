import Delaunator from "delaunator";
import { isInsideMask } from "./mask";
import type { BinaryMask } from "./mask";
import type { Point } from "./marchingSquares";

export type TriangulationResult = {
    triangles: Uint32Array;
    edges: Uint32Array;
};

function edgeKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function triangulate(points: Point[], mask: BinaryMask): TriangulationResult {
    if (points.length < 3) {
        return {
            triangles: new Uint32Array(),
            edges: new Uint32Array(),
        };
    }

    const delaunay = Delaunator.from(
        points,
        (p) => p.x,
        (p) => p.y,
    );
    const keptTriangles: number[] = [];
    const edges = new Set<string>();

    for (let i = 0; i < delaunay.triangles.length; i += 3) {
        const a = delaunay.triangles[i];
        const b = delaunay.triangles[i + 1];
        const c = delaunay.triangles[i + 2];

        const centroidX = (points[a].x + points[b].x + points[c].x) / 3;
        const centroidY = (points[a].y + points[b].y + points[c].y) / 3;
        if (!isInsideMask(mask, centroidX, centroidY)) continue;

        keptTriangles.push(a, b, c);
        edges.add(edgeKey(a, b));
        edges.add(edgeKey(b, c));
        edges.add(edgeKey(c, a));
    }

    const edgeArray = new Uint32Array(edges.size * 2);
    let offset = 0;
    edges.forEach((key) => {
        const [a, b] = key.split("-").map((v) => Number(v));
        edgeArray[offset] = a;
        edgeArray[offset + 1] = b;
        offset += 2;
    });

    return {
        triangles: Uint32Array.from(keptTriangles),
        edges: edgeArray,
    };
}
