import type { Mask } from "@/lib/detect";
import type { FrameState, Mesh } from "./types";
import { toBinaryMask } from "./mask";
import { extractOutline } from "./marchingSquares";
import { simplifyOutline } from "./simplify";
import { buildDetailMap } from "./detailMap";
import { sampleInteriorPoints } from "./poisson";
import type { MeshDensity } from "./poisson";
import { triangulate } from "./delaunay";

function flattenPoints(points: Array<{ x: number; y: number }>): Float32Array {
    const out = new Float32Array(points.length * 2);
    for (let i = 0; i < points.length; i += 1) {
        out[i * 2] = points[i].x;
        out[i * 2 + 1] = points[i].y;
    }
    return out;
}

export function buildFrame0Mesh(
    mask: Mask,
    density: MeshDensity,
    confidence: number,
): { mesh: Mesh; frame: FrameState } | null {
    return buildMeshForFrame(mask, density, confidence, 0);
}

export function buildMeshForFrame(
    mask: Mask,
    density: MeshDensity,
    confidence: number,
    frameIndex: number,
): { mesh: Mesh; frame: FrameState } | null {
    const binaryMask = toBinaryMask(mask, 0.5);
    const outline = simplifyOutline(extractOutline(binaryMask));
    if (outline.length < 3) return null;

    const detailMap = buildDetailMap(binaryMask);
    const interior = sampleInteriorPoints(binaryMask, detailMap, density, outline);
    const points = [...outline, ...interior];

    const triangulation = triangulate(points, binaryMask);
    const vertices = flattenPoints(points);
    const outlineIdx = new Uint32Array(outline.length);
    const isOutlineVertex = new Uint8Array(points.length);

    for (let i = 0; i < outline.length; i += 1) {
        outlineIdx[i] = i;
        isOutlineVertex[i] = 1;
    }

    const mesh: Mesh = {
        vertices,
        triangles: triangulation.triangles,
        edges: triangulation.edges,
        outlineIdx,
        isOutlineVertex,
        sourceFrameIdx: frameIndex,
    };

    const frame: FrameState = {
        keyframeId: frameIndex,
        vertices: new Float32Array(vertices),
        confidence,
    };

    return { mesh, frame };
}
