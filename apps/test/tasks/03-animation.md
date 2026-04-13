# 03 — Animation (frame-to-frame mesh propagation)

The core insight: we triangulate **once per keyframe** and between keyframes we only *move* existing vertices. No re-detection, no re-triangulation — just update positions.

Target: **≤ 8ms per non-keyframe** for propagation + render.

## The math

Given mesh `M_t` with vertices `V_t ∈ ℝ²ⁿ` and video frames `F_t`, `F_{t+1}`, we need a displacement field `Δ(x,y)` so that `V_{t+1} = V_t + Δ(V_t)` moves each vertex to its correct new position.

## Method — Dense optical flow + vertex sampling

### Option A (primary): DIS optical flow at low res
- **DIS** (Dense Inverse Search) is the best speed/quality flow algorithm for our size — OpenCV has it; we'll port the core to WASM or use OpenCV.js (careful: it's ~8MB — vendor only the flow module).
- Compute flow at **¼ resolution** (e.g. 480×270 for a 1920×1080 source): ~4ms.
- For each vertex, bilinearly sample `Δ` at the vertex coordinate; scale up by 4.
- Add **Laplacian smoothing** on the vertex displacement to suppress per-vertex jitter (1 iteration, λ=0.25) — keeps the mesh coherent.

### Option B (fallback when DIS is unavailable): Lucas-Kanade sparse tracking
- Track each vertex as a sparse point with pyramidal LK.
- Cheaper but more jittery; fine for slower scenes.

### Option C (extreme speed): affine-only motion
- Fit a single 2D affine transform from DIS flow (RANSAC over flow vectors inside the mask) and apply to every vertex.
- ~1ms total but loses articulated motion (legs, head) — only useful when the whole object moves rigidly (pan shots).

**Strategy: A by default; auto-switch to C when the flow field is near-uniform (variance below threshold — saves time on static shots).**

## Confidence & re-detection trigger

Per propagated frame, compute:
- **Forward-backward flow error** on a sparse grid inside the mask: sample flow forward `F_t → F_{t+1}`, then backward at those new points `F_{t+1} → F_t`; measure residual.
- **Vertex-on-mask consistency** (when we have a cheap proxy mask): at next keyframe check how many vertices fell outside.

If median FB error > 2px OR any vertex displacement > 20% of object bbox diagonal (cut detection / very fast motion), **force a keyframe** on the next frame.

## Boundary handling

Outline vertices carry special status — they must stay on (or very near) the silhouette contour even between keyframes. Options:

1. **Pure flow** — simplest, works when the object moves coherently. Risk: outline drifts inward/outward.
2. **Snap to a cheap proxy mask** — between keyframes, run a very light-weight edge estimator (e.g. gradient threshold) around each outline vertex's neighborhood and snap to the nearest edge within a small window (±5px). Adds ~2ms.

**Decision: start with pure flow; add snap-to-edge only if visual quality demands it.** Measure first.

## Interior mesh stability

Pure independent-per-vertex flow can create tangled triangles on fast articulation (e.g. a leg moves so a triangle flips).

Guard: after displacement, run **triangle flip detection** — any triangle whose signed area changes sign has flipped. Fix by averaging its vertices' motion with their 1-ring neighbors (one iteration of Laplacian smoothing applied locally).

If > 2% of triangles flipped in a single frame, treat as a discontinuity → force keyframe.

## Temporal smoothing

Even with Laplacian smoothing, raw flow produces jitter. Apply an **exponential moving average** per vertex:

```
V_{t+1} = α · (V_t + Δ) + (1-α) · V_t_ema
```

with α = 0.85 (light smoothing). Disable when a keyframe runs (hard reset).

## What gets persisted

For each propagated frame we store only the new vertex position buffer (2N floats). Triangles, edges, outline indices are shared with the source keyframe's mesh — that's memory-efficient and keeps animation identity.

```ts
type FrameState = {
  keyframeId: number;       // which mesh this frame derives from
  vertices: Float32Array;   // 2N floats
  confidence: number;       // median FB flow error (px)
};
```

## Implementation skeleton

```
apps/test/src/lib/flow/
  ├─ dis.ts              // DIS flow (vendored WASM or OpenCV.js subset)
  ├─ lk.ts               // LK fallback
  ├─ sampleFlow.ts       // bilinear sample Δ at vertex coords
  ├─ smooth.ts           // Laplacian + EMA
  ├─ guards.ts           // flip detection + FB error
  └─ propagator.ts       // orchestrate: in(prev, curr, mesh) → out(newMesh)
```

## Why not rigid-body trackers (e.g. CSRT, MOSSE)?

They give a bounding box, not per-vertex motion. Useless for articulated subjects (animal legs, head). Flow is the right primitive.

## Why not re-segment every frame?

Budget. BiRefNet at 100ms × 180 frames = 18s — 60% of our total budget for a single stage. Flow at 8ms × 180 = 1.4s. Massive win; accuracy loss acceptable when combined with every-10-frame keyframing.
