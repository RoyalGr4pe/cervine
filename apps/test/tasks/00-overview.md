# 00 — Pipeline Overview

## One-line summary

Decode video → segment foreground on keyframes → triangulate once → warp the mesh per-frame with optical flow → render wireframe to canvas → export frames.

## Stages & responsibilities

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ 1. Decode    │──▶│ 2. Segment   │──▶│ 3. Mesh      │──▶│ 4. Propagate │──▶│ 5. Render    │
│ WebCodecs    │   │ ONNX+WebGPU  │   │ Delaunay     │   │ Optical flow │   │ Canvas2D/SVG │
│ (main)       │   │ (worker A)   │   │ (worker B)   │   │ (worker B)   │   │ (main)       │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
       │                  ▲                                       │
       │                  └───── re-detect every N frames ◀───────┘
       │                          or when drift > threshold
       ▼
   Frame queue (ring buffer, backpressured)
```

### 1. Decode — WebCodecs `VideoDecoder`
- Pull `VideoFrame`s as fast as downstream can consume.
- Transfer frames (not copies) to workers via `postMessage` with `transfer` list.
- Budget: free — hardware-accelerated on all target browsers.

### 2. Segment — foreground mask per keyframe
- Model: **BiRefNet-lite** or **RMBG-1.4** in ONNX, WebGPU EP.
- Run only on **keyframes** (frame 0, then every N, plus on-demand when drift detected).
- Output: binary/α mask at model resolution (256–512), upscaled to video res.
- See [01-detection.md](./01-detection.md).

### 3. Mesh — Delaunay from the mask
- Extract outline (marching squares) → simplify (Douglas-Peucker) → sample interior Poisson-disk points → constrained Delaunay triangulation.
- Stored as `{ vertices: Float32Array, edges: Uint32Array, triangles: Uint32Array, outlineIdx: Uint32Array }`.
- See [02-triangulation.md](./02-triangulation.md).

### 4. Propagate — move existing vertices, keep topology
- Per non-keyframe: compute dense flow (DIS) between prev and current frame *at low res*, sample flow at each vertex, update vertex positions.
- Confidence: median forward-backward flow consistency. If > threshold, force re-detect.
- Cost: ~5–10ms/frame at 480p.
- See [03-animation.md](./03-animation.md).

### 5. Render — wireframe draw
- Canvas2D lines for outline + triangle edges. User-chosen line color/width, or sample source video pixel color at each edge's midpoint.
- Background: solid color in editor (default black), alpha-clear on export.
- See [05-rendering-export.md](./05-rendering-export.md).

## The critical tradeoff: keyframe interval N

Smaller N → more accurate but slower (segmentation is the bottleneck).
Larger N → faster but mesh drifts off the object.

Strategy: **adaptive N, starting at 10 frames (3× per second at 30fps)**, shortened to 5 if flow confidence drops, extended to 20 if object is barely moving. See [06-performance-budget.md](./06-performance-budget.md).

## What we explicitly are NOT doing

- Not using MediaPipe for segmentation — human-biased, weak on animals.
- Not running the segmentation model every frame — kills the budget.
- Not doing server-side processing — fully in-browser (WebGPU/WASM).
- Not re-triangulating on keyframes by default — we re-detect the mask but prefer to warp+patch the existing mesh to preserve animation identity. Full re-triangulation only when topology change is required (e.g. object splits / disappears / drift > 40%).
