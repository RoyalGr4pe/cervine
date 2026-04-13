# apps/test — Detect → Triangulate → Animate Pipeline

Fresh rebuild of the Cervine core pipeline, optimized for speed.

**Hard budget:** 6-second 30fps video (180 frames) processed end-to-end in ≤ 30s; live preview streams as frames complete. First triangulated frame visible in ≤ 1.5s after upload.

## Reading order

1. [00-overview.md](./00-overview.md) — pipeline, budget, tradeoffs
2. [01-detection.md](./01-detection.md) — object detection / segmentation (the critical path)
3. [02-triangulation.md](./02-triangulation.md) — building the wireframe mesh from the mask
4. [03-animation.md](./03-animation.md) — propagating the mesh across frames without re-detecting
5. [04-ui-layout.md](./04-ui-layout.md) — upload + live preview + controls
6. [05-rendering-export.md](./05-rendering-export.md) — canvas/SVG render + export with transparency
7. [06-performance-budget.md](./06-performance-budget.md) — per-stage latency targets and fallbacks
8. [07-implementation-phases.md](./07-implementation-phases.md) — execution order with checkpoints

## Guiding principles

- **Detection is sacred.** Accuracy on the first (and keyframe) frames decides everything downstream. Spend the compute budget there.
- **Propagate, don't re-detect.** Between keyframes, move existing mesh vertices with optical flow. Re-detect only every N frames (adaptive) and whenever confidence drops.
- **Stream, don't batch.** Decode → detect → triangulate → render per-frame in a pipeline; the user sees frames landing.
- **WebGPU first, WASM fallback.** ONNX Runtime Web with `webgpu` EP; fall back to `wasm` with SIMD+threads if unavailable.
- **One worker per stage.** Decode on main, segmentation in a dedicated worker, flow in another. Keep the UI thread free.
