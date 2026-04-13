import { Delaunay } from "d3-delaunay";

export type RenderMode = "dots" | "delaunay";
export type MeshColorMode = "average" | "single";

export interface RenderDot {
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
    opacity?: number;
}

export interface RenderOptions {
    mode: RenderMode;
    dotSize: number;
    meshLineWidth: number;
    meshColorMode: MeshColorMode;
    meshSingleColor: string | null;
}

interface MeshEdge {
    key: string;
    a: number;
    b: number;
    color: string;
    triangleCount: number;
    fingerprint: string;
    triangles: number[];
}

interface MeshTriangle {
    a: number;
    b: number;
    c: number;
    r: number;
    g: number;
    bch: number;
    alpha: number;
}

const INTERIOR_EDGE_DROP_RATE = 0.58;
const EDGE_HASH_QUANTIZE = 3;
const POLYGON_FILL_ALPHA_AVERAGE = 0.34;
const POLYGON_FILL_ALPHA_SINGLE = 0.26;

function clamp01(n: number): number {
    return Math.max(0, Math.min(1, n));
}

function dotToStyle(dot: RenderDot): string {
    const alpha = typeof dot.opacity === "number" ? clamp01(dot.opacity) : 1;
    return `rgba(${dot.r},${dot.g},${dot.b},${alpha})`;
}

function hash01(input: string): number {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
}

function edgeFingerprint(a: RenderDot, b: RenderDot): string {
    const ax = Math.round(a.x / EDGE_HASH_QUANTIZE) * EDGE_HASH_QUANTIZE;
    const ay = Math.round(a.y / EDGE_HASH_QUANTIZE) * EDGE_HASH_QUANTIZE;
    const bx = Math.round(b.x / EDGE_HASH_QUANTIZE) * EDGE_HASH_QUANTIZE;
    const by = Math.round(b.y / EDGE_HASH_QUANTIZE) * EDGE_HASH_QUANTIZE;

    if (ax < bx || (ax === bx && ay <= by)) {
        return `${ax},${ay}|${bx},${by}`;
    }
    return `${bx},${by}|${ax},${ay}`;
}

function edgeDist2(a: RenderDot, b: RenderDot): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

function triangleHasLongEdge(
    a: RenderDot,
    b: RenderDot,
    c: RenderDot,
    maxEdge2: number,
): boolean {
    return (
        edgeDist2(a, b) > maxEdge2 ||
        edgeDist2(b, c) > maxEdge2 ||
        edgeDist2(c, a) > maxEdge2
    );
}

function makeTriangle(ai: number, bi: number, ci: number, dots: RenderDot[]): MeshTriangle {
    const a = dots[ai]!;
    const b = dots[bi]!;
    const c = dots[ci]!;
    return {
        a: ai,
        b: bi,
        c: ci,
        r: Math.round((a.r + b.r + c.r) / 3),
        g: Math.round((a.g + b.g + c.g) / 3),
        bch: Math.round((a.b + b.b + c.b) / 3),
        alpha: clamp01(((a.opacity ?? 1) + (b.opacity ?? 1) + (c.opacity ?? 1)) / 3),
    };
}

function findRoot(parent: Uint32Array, i: number): number {
    let n = i;
    while (parent[n] !== n) {
        const p = parent[n]!;
        parent[n] = parent[p]!;
        n = parent[n]!;
    }
    return n;
}

function union(parent: Uint32Array, a: number, b: number): void {
    const ra = findRoot(parent, a);
    const rb = findRoot(parent, b);
    if (ra !== rb) {
        parent[rb] = ra;
    }
}

function estimateMaxEdgeLength(delaunay: Delaunay<[number, number]>, dots: RenderDot[]): number {
    if (dots.length < 2) return 40;

    const nearest: number[] = [];
    for (let i = 0; i < dots.length; i++) {
        let minDist2 = Number.POSITIVE_INFINITY;
        for (const n of delaunay.neighbors(i)) {
            const a = dots[i]!;
            const b = dots[n]!;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < minDist2) minDist2 = d2;
        }
        if (Number.isFinite(minDist2)) nearest.push(Math.sqrt(minDist2));
    }

    if (!nearest.length) return 40;
    nearest.sort((a, b) => a - b);
    const median = nearest[Math.floor(nearest.length / 2)]!;
    return Math.max(18, median * 4.25);
}

export function renderDots(
    ctx: CanvasRenderingContext2D,
    dots: RenderDot[],
    dotSize: number,
): void {
    for (const dot of dots) {
        const alpha = dot.opacity;
        if (typeof alpha === "number" && alpha <= 0) continue;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dotSize, 0, Math.PI * 2);
        ctx.fillStyle = dotToStyle(dot);
        ctx.fill();
    }
}

export function renderDelaunay(
    ctx: CanvasRenderingContext2D,
    dots: RenderDot[],
    options: Pick<RenderOptions, "meshLineWidth" | "meshColorMode" | "meshSingleColor">,
): void {
    if (dots.length < 3) {
        renderDots(ctx, dots, 1.5);
        return;
    }

    const points: [number, number][] = dots.map((d) => [d.x, d.y]);
    const delaunay = Delaunay.from(points);
    const triangles = delaunay.triangles;
    const maxEdgeLength = estimateMaxEdgeLength(delaunay, dots);
    const maxEdge2 = maxEdgeLength * maxEdgeLength;

    const meshTriangles: MeshTriangle[] = [];
    const edges = new Map<string, MeshEdge>();
    const pickColor = (ai: number, bi: number): string => {
        if (options.meshColorMode === "single") {
            return options.meshSingleColor ?? "#ffffff";
        }
        const a = dots[ai]!;
        const b = dots[bi]!;
        const r = Math.round((a.r + b.r) / 2);
        const g = Math.round((a.g + b.g) / 2);
        const bch = Math.round((a.b + b.b) / 2);
        const alpha = clamp01(((a.opacity ?? 1) + (b.opacity ?? 1)) / 2);
        return `rgba(${r},${g},${bch},${alpha})`;
    };

    const addEdge = (a: number, b: number, triangleIndex: number) => {
        const low = Math.min(a, b);
        const high = Math.max(a, b);
        const key = `${low}-${high}`;

        const p1 = dots[low]!;
        const p2 = dots[high]!;
        if (edgeDist2(p1, p2) > maxEdge2) return;

        const existing = edges.get(key);
        if (existing) {
            existing.triangleCount += 1;
            existing.triangles.push(triangleIndex);
            return;
        }

        edges.set(key, {
            key,
            a: low,
            b: high,
            color: pickColor(low, high),
            triangleCount: 1,
            fingerprint: edgeFingerprint(p1, p2),
            triangles: [triangleIndex],
        });
    };

    for (let i = 0; i < triangles.length; i += 3) {
        const a = triangles[i]!;
        const b = triangles[i + 1]!;
        const c = triangles[i + 2]!;
        const da = dots[a]!;
        const db = dots[b]!;
        const dc = dots[c]!;
        if (triangleHasLongEdge(da, db, dc, maxEdge2)) {
            continue;
        }

        const triangleIndex = meshTriangles.length;
        meshTriangles.push(makeTriangle(a, b, c, dots));

        addEdge(a, b, triangleIndex);
        addEdge(b, c, triangleIndex);
        addEdge(c, a, triangleIndex);
    }

    if (meshTriangles.length === 0) {
        renderDots(ctx, dots, 1.5);
        return;
    }

    const allEdges = Array.from(edges.values());
    const degree = new Uint16Array(dots.length);
    for (const edge of allEdges) {
        degree[edge.a] = (degree[edge.a] ?? 0) + 1;
        degree[edge.b] = (degree[edge.b] ?? 0) + 1;
    }

    const keptKeys = new Set<string>();
    const interior = allEdges.filter((e) => e.triangleCount > 1);
    interior.sort((a, b) => hash01(a.fingerprint) - hash01(b.fingerprint));

    for (const edge of allEdges) {
        if (edge.triangleCount <= 1) {
            keptKeys.add(edge.key);
        }
    }

    for (const edge of interior) {
        const shouldDrop = hash01(edge.fingerprint) < INTERIOR_EDGE_DROP_RATE;
        const degreeA = degree[edge.a] ?? 0;
        const degreeB = degree[edge.b] ?? 0;
        if (shouldDrop && degreeA > 2 && degreeB > 2) {
            degree[edge.a] = degreeA - 1;
            degree[edge.b] = degreeB - 1;
            continue;
        }
        keptKeys.add(edge.key);
    }

    const parent = new Uint32Array(meshTriangles.length);
    for (let i = 0; i < meshTriangles.length; i++) {
        parent[i] = i;
    }

    for (const edge of allEdges) {
        if (edge.triangleCount !== 2 || keptKeys.has(edge.key)) {
            continue;
        }

        const t0 = edge.triangles[0];
        const t1 = edge.triangles[1];
        if (t0 === undefined || t1 === undefined) {
            continue;
        }
        union(parent, t0, t1);
    }

    type Component = {
        triangles: number[];
        sumR: number;
        sumG: number;
        sumB: number;
        sumA: number;
    };

    const components = new Map<number, Component>();
    for (let i = 0; i < meshTriangles.length; i++) {
        const root = findRoot(parent, i);
        const tri = meshTriangles[i]!;
        const existing = components.get(root);
        if (existing) {
            existing.triangles.push(i);
            existing.sumR += tri.r;
            existing.sumG += tri.g;
            existing.sumB += tri.bch;
            existing.sumA += tri.alpha;
            continue;
        }
        components.set(root, {
            triangles: [i],
            sumR: tri.r,
            sumG: tri.g,
            sumB: tri.bch,
            sumA: tri.alpha,
        });
    }

    ctx.save();
    for (const component of components.values()) {
        const count = component.triangles.length;
        if (count <= 0) {
            continue;
        }

        ctx.beginPath();
        for (const triIndex of component.triangles) {
            const tri = meshTriangles[triIndex]!;
            const a = dots[tri.a]!;
            const b = dots[tri.b]!;
            const c = dots[tri.c]!;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.lineTo(c.x, c.y);
            ctx.closePath();
        }

        if (options.meshColorMode === "single") {
            ctx.globalAlpha = POLYGON_FILL_ALPHA_SINGLE;
            ctx.fillStyle = options.meshSingleColor ?? "#ffffff";
        } else {
            const avgR = Math.round(component.sumR / count);
            const avgG = Math.round(component.sumG / count);
            const avgB = Math.round(component.sumB / count);
            const avgA = clamp01((component.sumA / count) * POLYGON_FILL_ALPHA_AVERAGE);
            ctx.globalAlpha = 1;
            ctx.fillStyle = `rgba(${avgR},${avgG},${avgB},${avgA})`;
        }

        ctx.fill();
    }
    ctx.restore();

    const keptInterior: MeshEdge[] = [];
    const boundary: MeshEdge[] = [];
    for (const edge of allEdges) {
        if (!keptKeys.has(edge.key)) {
            continue;
        }
        if (edge.triangleCount <= 1) {
            boundary.push(edge);
        } else {
            keptInterior.push(edge);
        }
    }

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(0.5, options.meshLineWidth * 0.9);
    for (const edge of keptInterior) {
        const a = dots[edge.a]!;
        const b = dots[edge.b]!;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = edge.color;
        ctx.stroke();
    }

    ctx.lineWidth = Math.max(1, options.meshLineWidth * 1.9);
    ctx.strokeStyle = options.meshColorMode === "single"
        ? (options.meshSingleColor ?? "#ffffff")
        : "rgba(245,245,245,0.95)";
    for (const edge of boundary) {
        const a = dots[edge.a]!;
        const b = dots[edge.b]!;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }
}

export function renderFrame(
    ctx: CanvasRenderingContext2D,
    dots: RenderDot[],
    options: RenderOptions,
): void {
    if (options.mode === "delaunay") {
        renderDelaunay(ctx, dots, {
            meshLineWidth: options.meshLineWidth,
            meshColorMode: options.meshColorMode,
            meshSingleColor: options.meshSingleColor,
        });
        return;
    }
    renderDots(ctx, dots, options.dotSize);
}
