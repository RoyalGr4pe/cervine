import type { FrameState, Mesh } from "@/lib/mesh";

type Bounds = { x0: number; y0: number; x1: number; y1: number };

type FlowAnchor = {
    x: number;
    y: number;
    dx: number;
    dy: number;
    confidence: number;
};

type SparseFlow = {
    anchors: FlowAnchor[];
    meanDx: number;
    meanDy: number;
    variance: number;
    confidence: number;
};

type AffineParams = {
    a: number;
    b: number;
    tx: number;
    c: number;
    d: number;
    ty: number;
};

export type PropagationResult = {
    frame: FrameState;
    confidence: number;
    flowVariance: number;
    flipRatio: number;
    forceKeyframe: boolean;
};

export type PropagationInput = {
    mesh: Mesh;
    previousFrame: FrameState;
    previousGray: Float32Array;
    currentGray: Float32Array;
    width: number;
    height: number;
    alpha?: number;
    laplacianLambda?: number;
    searchRadius?: number;
    patchRadius?: number;
};

const DEFAULT_ALPHA = 0.85;
const DEFAULT_LAPLACIAN = 0.16;
const DEFAULT_SEARCH_RADIUS = 8;
const DEFAULT_PATCH_RADIUS = 3;
const MAX_ANCHORS = 48;

const adjacencyCache = new WeakMap<Mesh, Uint32Array[]>();

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
    return clamp(value, 0, 1);
}

function getGray(
    data: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
): number {
    const cx = clamp(Math.round(x), 0, width - 1);
    const cy = clamp(Math.round(y), 0, height - 1);
    return data[cy * width + cx] ?? 0;
}

function gradientAt(
    gray: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
): number {
    const gx = getGray(gray, width, height, x + 1, y) - getGray(gray, width, height, x - 1, y);
    const gy = getGray(gray, width, height, x, y + 1) - getGray(gray, width, height, x, y - 1);
    return gx * gx + gy * gy;
}

function boundsFromVertices(vertices: Float32Array, width: number, height: number): Bounds {
    if (vertices.length < 2) {
        return { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
    }

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    for (let i = 0; i < vertices.length; i += 2) {
        const x = vertices[i] ?? 0;
        const y = vertices[i + 1] ?? 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    const padX = Math.max(12, Math.round((maxX - minX) * 0.2));
    const padY = Math.max(12, Math.round((maxY - minY) * 0.2));

    return {
        x0: clamp(Math.round(minX - padX), 0, width - 1),
        y0: clamp(Math.round(minY - padY), 0, height - 1),
        x1: clamp(Math.round(maxX + padX), 0, width - 1),
        y1: clamp(Math.round(maxY + padY), 0, height - 1),
    };
}

function pickAnchorPoints(
    gray: Float32Array,
    width: number,
    height: number,
    bounds: Bounds,
    maxAnchors: number,
): Array<{ x: number; y: number }> {
    const bw = Math.max(1, bounds.x1 - bounds.x0 + 1);
    const bh = Math.max(1, bounds.y1 - bounds.y0 + 1);
    const step = Math.max(6, Math.round(Math.min(bw, bh) / 10));
    const minDist = Math.max(6, step * 0.9);

    const candidates: Array<{ x: number; y: number; score: number }> = [];
    for (let y = bounds.y0; y <= bounds.y1; y += step) {
        for (let x = bounds.x0; x <= bounds.x1; x += step) {
            candidates.push({ x, y, score: gradientAt(gray, width, height, x, y) });
        }
    }

    candidates.sort((a, b) => b.score - a.score);

    const anchors: Array<{ x: number; y: number }> = [];
    for (const candidate of candidates) {
        if (anchors.length >= maxAnchors) break;

        let tooClose = false;
        for (const anchor of anchors) {
            const dx = candidate.x - anchor.x;
            const dy = candidate.y - anchor.y;
            if (dx * dx + dy * dy < minDist * minDist) {
                tooClose = true;
                break;
            }
        }

        if (!tooClose) {
            anchors.push({ x: candidate.x, y: candidate.y });
        }
    }

    return anchors;
}

function patchSad(
    previous: Float32Array,
    current: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    patchRadius: number,
): number {
    let sad = 0;

    for (let py = -patchRadius; py <= patchRadius; py += 1) {
        for (let px = -patchRadius; px <= patchRadius; px += 1) {
            const p = getGray(previous, width, height, x + px, y + py);
            const n = getGray(current, width, height, x + dx + px, y + dy + py);
            sad += Math.abs(p - n);
        }
    }

    return sad;
}

function trackAnchor(
    previous: Float32Array,
    current: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
    searchRadius: number,
    patchRadius: number,
): FlowAnchor | null {
    let bestSad = Number.POSITIVE_INFINITY;
    let secondSad = Number.POSITIVE_INFINITY;
    let bestDx = 0;
    let bestDy = 0;

    for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
        for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
            const sad = patchSad(previous, current, width, height, x, y, dx, dy, patchRadius);
            if (sad < bestSad) {
                secondSad = bestSad;
                bestSad = sad;
                bestDx = dx;
                bestDy = dy;
            } else if (sad < secondSad) {
                secondSad = sad;
            }
        }
    }

    const patchArea = (patchRadius * 2 + 1) ** 2;
    const normalizedSad = bestSad / Math.max(1, patchArea * 255);
    const distinctness = Number.isFinite(secondSad) && secondSad > 0
        ? clamp01((secondSad - bestSad) / secondSad)
        : 0;

    const confidence = clamp01((1 - normalizedSad / 0.35) * (0.5 + distinctness * 0.5));
    if (confidence < 0.2) return null;

    return { x, y, dx: bestDx, dy: bestDy, confidence };
}

function estimateSparseFlow(
    previous: Float32Array,
    current: Float32Array,
    width: number,
    height: number,
    vertices: Float32Array,
    searchRadius: number,
    patchRadius: number,
): SparseFlow {
    const bounds = boundsFromVertices(vertices, width, height);
    const candidates = pickAnchorPoints(previous, width, height, bounds, MAX_ANCHORS);
    const anchors: FlowAnchor[] = [];

    for (const candidate of candidates) {
        const tracked = trackAnchor(
            previous,
            current,
            width,
            height,
            candidate.x,
            candidate.y,
            searchRadius,
            patchRadius,
        );
        if (tracked) anchors.push(tracked);
    }

    if (anchors.length === 0) {
        return {
            anchors,
            meanDx: 0,
            meanDy: 0,
            variance: Number.POSITIVE_INFINITY,
            confidence: 0,
        };
    }

    let sumDx = 0;
    let sumDy = 0;
    let sumConfidence = 0;
    for (const anchor of anchors) {
        sumDx += anchor.dx;
        sumDy += anchor.dy;
        sumConfidence += anchor.confidence;
    }

    const meanDx = sumDx / anchors.length;
    const meanDy = sumDy / anchors.length;

    let variance = 0;
    for (const anchor of anchors) {
        const ddx = anchor.dx - meanDx;
        const ddy = anchor.dy - meanDy;
        variance += ddx * ddx + ddy * ddy;
    }
    variance /= anchors.length;

    return {
        anchors,
        meanDx,
        meanDy,
        variance,
        confidence: clamp01(sumConfidence / anchors.length),
    };
}

function fitAffine(anchors: FlowAnchor[]): AffineParams | null {
    if (anchors.length < 3) return null;

    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;

    let sxpx = 0;
    let sypx = 0;
    let spx = 0;

    let sxpy = 0;
    let sypy = 0;
    let spy = 0;

    for (const anchor of anchors) {
        const px = anchor.x + anchor.dx;
        const py = anchor.y + anchor.dy;

        sx += anchor.x;
        sy += anchor.y;
        sxx += anchor.x * anchor.x;
        sxy += anchor.x * anchor.y;
        syy += anchor.y * anchor.y;

        sxpx += anchor.x * px;
        sypx += anchor.y * px;
        spx += px;

        sxpy += anchor.x * py;
        sypy += anchor.y * py;
        spy += py;
    }

    const n = anchors.length;

    const det3 = (
        m: [[number, number, number], [number, number, number], [number, number, number]],
    ): number =>
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

    const A: [[number, number, number], [number, number, number], [number, number, number]] = [
        [sxx, sxy, sx],
        [sxy, syy, sy],
        [sx, sy, n],
    ];

    const detA = det3(A);
    if (Math.abs(detA) < 1e-6) return null;

    const solve = (rhs: [number, number, number]): [number, number, number] => {
        const Ax: [[number, number, number], [number, number, number], [number, number, number]] = [
            [rhs[0], A[0][1], A[0][2]],
            [rhs[1], A[1][1], A[1][2]],
            [rhs[2], A[2][1], A[2][2]],
        ];
        const Ay: [[number, number, number], [number, number, number], [number, number, number]] = [
            [A[0][0], rhs[0], A[0][2]],
            [A[1][0], rhs[1], A[1][2]],
            [A[2][0], rhs[2], A[2][2]],
        ];
        const Az: [[number, number, number], [number, number, number], [number, number, number]] = [
            [A[0][0], A[0][1], rhs[0]],
            [A[1][0], A[1][1], rhs[1]],
            [A[2][0], A[2][1], rhs[2]],
        ];

        return [det3(Ax) / detA, det3(Ay) / detA, det3(Az) / detA];
    };

    const [a, b, tx] = solve([sxpx, sypx, spx]);
    const [c, d, ty] = solve([sxpy, sypy, spy]);

    const scale = Math.sqrt(a * a + c * c);
    if (!Number.isFinite(scale) || scale < 0.92 || scale > 1.08) return null;

    return { a, b, tx, c, d, ty };
}

function applyAffineToVertices(
    vertices: Float32Array,
    affine: AffineParams,
    width: number,
    height: number,
): Float32Array {
    const out = new Float32Array(vertices.length);

    for (let i = 0; i < vertices.length; i += 2) {
        const x = vertices[i] ?? 0;
        const y = vertices[i + 1] ?? 0;
        out[i] = clamp(affine.a * x + affine.b * y + affine.tx, 0, width - 1);
        out[i + 1] = clamp(affine.c * x + affine.d * y + affine.ty, 0, height - 1);
    }

    return out;
}

function applyIdwFlowToVertices(
    vertices: Float32Array,
    flow: SparseFlow,
    width: number,
    height: number,
): Float32Array {
    const out = new Float32Array(vertices.length);

    for (let i = 0; i < vertices.length; i += 2) {
        const x = vertices[i] ?? 0;
        const y = vertices[i + 1] ?? 0;

        let weightedDx = 0;
        let weightedDy = 0;
        let weightSum = 0;

        for (const anchor of flow.anchors) {
            const dx = x - anchor.x;
            const dy = y - anchor.y;
            const dist2 = dx * dx + dy * dy;

            if (dist2 < 1) {
                weightedDx = anchor.dx;
                weightedDy = anchor.dy;
                weightSum = 1;
                break;
            }

            const weight = anchor.confidence / (dist2 + 1);
            weightedDx += anchor.dx * weight;
            weightedDy += anchor.dy * weight;
            weightSum += weight;
        }

        if (weightSum > 0) {
            weightedDx /= weightSum;
            weightedDy /= weightSum;
        } else {
            weightedDx = flow.meanDx;
            weightedDy = flow.meanDy;
        }

        out[i] = clamp(x + weightedDx, 0, width - 1);
        out[i + 1] = clamp(y + weightedDy, 0, height - 1);
    }

    return out;
}

function getAdjacency(mesh: Mesh): Uint32Array[] {
    const cached = adjacencyCache.get(mesh);
    if (cached) return cached;

    const count = Math.floor(mesh.vertices.length / 2);
    const sets = Array.from({ length: count }, () => new Set<number>());

    for (let i = 0; i + 1 < mesh.edges.length; i += 2) {
        const a = mesh.edges[i] ?? 0;
        const b = mesh.edges[i + 1] ?? 0;
        if (a >= count || b >= count || a === b) continue;
        sets[a].add(b);
        sets[b].add(a);
    }

    const adjacency = sets.map((set) => Uint32Array.from(set));
    adjacencyCache.set(mesh, adjacency);
    return adjacency;
}

function smoothDisplacement(
    previous: Float32Array,
    predicted: Float32Array,
    adjacency: Uint32Array[],
    isOutlineVertex: Uint8Array,
    lambda: number,
    iterations = 1,
): Float32Array {
    let current = new Float32Array(predicted.length);
    for (let i = 0; i < predicted.length; i += 1) {
        current[i] = (predicted[i] ?? 0) - (previous[i] ?? 0);
    }

    for (let iteration = 0; iteration < iterations; iteration += 1) {
        const next = new Float32Array(current);

        for (let vertex = 0; vertex < adjacency.length; vertex += 1) {
            const neighbors = adjacency[vertex];
            if (!neighbors || neighbors.length === 0) continue;

            let meanX = 0;
            let meanY = 0;
            for (let i = 0; i < neighbors.length; i += 1) {
                const n = neighbors[i] ?? 0;
                meanX += current[n * 2] ?? 0;
                meanY += current[n * 2 + 1] ?? 0;
            }
            meanX /= neighbors.length;
            meanY /= neighbors.length;

            const index = vertex * 2;
            const curX = current[index] ?? 0;
            const curY = current[index + 1] ?? 0;

            const strength = (isOutlineVertex[index / 2] ?? 0) > 0 ? lambda * 0.6 : lambda;
            next[index] = curX + (meanX - curX) * strength;
            next[index + 1] = curY + (meanY - curY) * strength;
        }

        current = next;
    }

    const out = new Float32Array(predicted.length);
    for (let i = 0; i < out.length; i += 1) {
        out[i] = (previous[i] ?? 0) + (current[i] ?? 0);
    }
    return out;
}

function applyTranslation(
    previous: Float32Array,
    dx: number,
    dy: number,
    width: number,
    height: number,
): Float32Array {
    const out = new Float32Array(previous.length);
    for (let i = 0; i < previous.length; i += 2) {
        out[i] = clamp((previous[i] ?? 0) + dx, 0, width - 1);
        out[i + 1] = clamp((previous[i + 1] ?? 0) + dy, 0, height - 1);
    }
    return out;
}

function bboxArea(vertices: Float32Array): number {
    if (vertices.length < 2) return 0;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < vertices.length; i += 2) {
        const x = vertices[i] ?? 0;
        const y = vertices[i + 1] ?? 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }

    return Math.max(1, (maxX - minX) * (maxY - minY));
}

function blendEma(
    predicted: Float32Array,
    previous: Float32Array,
    alpha: number,
): Float32Array {
    const out = new Float32Array(predicted.length);
    for (let i = 0; i < predicted.length; i += 1) {
        const p = predicted[i] ?? 0;
        const prev = previous[i] ?? p;
        out[i] = p * alpha + prev * (1 - alpha);
    }
    return out;
}

function triangleArea(
    vertices: Float32Array,
    ai: number,
    bi: number,
    ci: number,
): number {
    const ax = vertices[ai * 2] ?? 0;
    const ay = vertices[ai * 2 + 1] ?? 0;
    const bx = vertices[bi * 2] ?? 0;
    const by = vertices[bi * 2 + 1] ?? 0;
    const cx = vertices[ci * 2] ?? 0;
    const cy = vertices[ci * 2 + 1] ?? 0;

    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function computeFlipRatio(
    mesh: Mesh,
    previous: Float32Array,
    next: Float32Array,
): number {
    const triCount = Math.floor(mesh.triangles.length / 3);
    if (triCount === 0) return 0;

    let flips = 0;
    for (let i = 0; i + 2 < mesh.triangles.length; i += 3) {
        const a = mesh.triangles[i] ?? 0;
        const b = mesh.triangles[i + 1] ?? 0;
        const c = mesh.triangles[i + 2] ?? 0;

        const areaPrev = triangleArea(previous, a, b, c);
        const areaNext = triangleArea(next, a, b, c);

        if (Math.abs(areaPrev) < 1e-4 || Math.abs(areaNext) < 1e-4) continue;
        if (areaPrev * areaNext < 0) flips += 1;
    }

    return flips / triCount;
}

function clampVertices(vertices: Float32Array, width: number, height: number): void {
    for (let i = 0; i < vertices.length; i += 2) {
        vertices[i] = clamp(vertices[i] ?? 0, 0, width - 1);
        vertices[i + 1] = clamp(vertices[i + 1] ?? 0, 0, height - 1);
    }
}

export function rgbaToGray(frame: ImageData): Float32Array {
    const { width, height, data } = frame;
    const out = new Float32Array(width * height);

    for (let i = 0; i < width * height; i += 1) {
        const p = i * 4;
        const r = data[p] ?? 0;
        const g = data[p + 1] ?? 0;
        const b = data[p + 2] ?? 0;
        out[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    return out;
}

export function propagateMeshFrame(input: PropagationInput): PropagationResult {
    const {
        mesh,
        previousFrame,
        previousGray,
        currentGray,
        width,
        height,
        alpha = DEFAULT_ALPHA,
        laplacianLambda = DEFAULT_LAPLACIAN,
        searchRadius = DEFAULT_SEARCH_RADIUS,
        patchRadius = DEFAULT_PATCH_RADIUS,
    } = input;

    const previousVertices =
        previousFrame.vertices.length === mesh.vertices.length
            ? previousFrame.vertices
            : mesh.vertices;

    const flow = estimateSparseFlow(
        previousGray,
        currentGray,
        width,
        height,
        previousVertices,
        searchRadius,
        patchRadius,
    );

    const affine = flow.anchors.length >= 8 && flow.variance < 0.7 && flow.confidence > 0.65
        ? fitAffine(flow.anchors)
        : null;

    let predicted = affine
        ? applyAffineToVertices(previousVertices, affine, width, height)
        : applyIdwFlowToVertices(previousVertices, flow, width, height);

    const adjacency = getAdjacency(mesh);
    predicted = smoothDisplacement(
        previousVertices,
        predicted,
        adjacency,
        mesh.isOutlineVertex,
        laplacianLambda,
        1,
    );

    let nextVertices = blendEma(predicted, previousVertices, clamp01(alpha));
    clampVertices(nextVertices, width, height);

    const previousArea = bboxArea(previousVertices);
    const nextArea = bboxArea(nextVertices);
    const areaRatio = nextArea / Math.max(1, previousArea);
    if (areaRatio < 0.85 || areaRatio > 1.18) {
        const translated = applyTranslation(
            previousVertices,
            flow.meanDx,
            flow.meanDy,
            width,
            height,
        );
        nextVertices = blendEma(translated, previousVertices, clamp01(alpha + 0.04));
        clampVertices(nextVertices, width, height);
    }

    let flipRatio = computeFlipRatio(mesh, previousVertices, nextVertices);
    if (flipRatio > 0.02) {
        const repaired = smoothDisplacement(
            previousVertices,
            nextVertices,
            adjacency,
            mesh.isOutlineVertex,
            laplacianLambda * 1.35,
            1,
        );
        nextVertices = blendEma(repaired, previousVertices, clamp01(alpha + 0.08));
        clampVertices(nextVertices, width, height);
        flipRatio = computeFlipRatio(mesh, previousVertices, nextVertices);
    }

    const confidence = clamp01(
        flow.confidence * (1 - Math.min(1, flipRatio * 7)),
    );

    const forceKeyframe = confidence < 0.22 || flipRatio > 0.08;

    return {
        frame: {
            keyframeId: previousFrame.keyframeId,
            vertices: nextVertices,
            confidence,
        },
        confidence,
        flowVariance: flow.variance,
        flipRatio,
        forceKeyframe,
    };
}
