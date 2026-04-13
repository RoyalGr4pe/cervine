import type { Mesh, FrameState } from "@/lib/mesh";

export type DrawSettings = {
    lineColor: string;
    lineWidth: number;
    backgroundColor: string | null; // null = transparent (export)
    useSourceColor: boolean;
    sourceFrame?: ImageData | null;
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function sampleEdgeColor(
    source: ImageData,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
): string {
    const mx = clamp(Math.round((x0 + x1) * 0.5), 0, source.width - 1);
    const my = clamp(Math.round((y0 + y1) * 0.5), 0, source.height - 1);
    const i = (my * source.width + mx) * 4;
    const r = source.data[i];
    const g = source.data[i + 1];
    const b = source.data[i + 2];
    return `rgb(${r},${g},${b})`;
}

export function drawMesh(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    mesh: Mesh,
    frame: FrameState,
    settings: DrawSettings,
): void {
    if (mesh.edges.length < 2 || frame.vertices.length < 4) return;

    const source = settings.useSourceColor ? settings.sourceFrame ?? null : null;
    ctx.lineWidth = settings.lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    for (let i = 0; i < mesh.edges.length; i += 2) {
        const a = mesh.edges[i];
        const b = mesh.edges[i + 1];
        const ai = a * 2;
        const bi = b * 2;
        if (bi + 1 >= frame.vertices.length || ai + 1 >= frame.vertices.length) continue;

        const x0 = frame.vertices[ai];
        const y0 = frame.vertices[ai + 1];
        const x1 = frame.vertices[bi];
        const y1 = frame.vertices[bi + 1];

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = source
            ? sampleEdgeColor(source, x0, y0, x1, y1)
            : settings.lineColor;
        ctx.stroke();
    }
}
