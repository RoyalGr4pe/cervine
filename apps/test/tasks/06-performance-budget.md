# 06 — Performance Budget

## Hard constraints
- 6s video (≈180 frames @ 30fps) must process in **≤ 30s** total.
- First wireframe frame visible **≤ 1.5s** after upload completes.
- UI thread must stay responsive (no frame longer than 16ms on main).

## Per-stage budget (WebGPU target device: M2 / RTX 3060 / equiv.)

| Stage | Budget/frame | Frames | Total |
|---|---|---|---|
| Decode (WebCodecs) | ~2ms | 180 | 360ms (overlapped with next stages) |
| YOLO locator (keyframe only) | 25ms | 18 | 450ms |
| BiRefNet segment (keyframe only) | 100ms | 18 | 1800ms |
| Mask cleanup + CC (keyframe) | 5ms | 18 | 90ms |
| Triangulation (keyframe) | 15ms | 18 | 270ms |
| Mesh patch (keyframe ≥ 1) | 5ms | 17 | 85ms |
| DIS flow (non-keyframe) | 6ms | 162 | 972ms |
| Sample flow + smooth (non-keyframe) | 1ms | 162 | 162ms |
| Render wireframe | 3ms | 180 | 540ms |
| **Total (sequential)** | | | **~4.7s** |

With workers running in parallel to decode/render, expect real-world ≈ **5–8s** on a decent laptop.

## WASM fallback budget (no WebGPU)

| Stage | Budget |
|---|---|
| BiRefNet int8 WASM-SIMD | ~400ms/keyframe → 7.2s total |
| DIS flow WASM-SIMD | ~15ms/frame → 2.4s total |

Realistic total **18–25s** for 6s video — still under budget.

## Device detection / routing

On first run:
1. Detect `navigator.gpu` + adapter. If WebGPU, use it.
2. Check `navigator.hardwareConcurrency` ≥ 4 and `deviceMemory` ≥ 4 → allow high-density triangulation.
3. Otherwise → medium density, WASM EP, 1 fewer worker.

## Memory budget

- 180 × `FrameState` (2N floats, N ≈ 600) = ~860KB. Negligible.
- 18 × `Mesh` (edges Uint32, triangles Uint32, outlineIdx) ≈ 3MB. Negligible.
- Decoded `VideoFrame`s: **do not retain**. Consume and close. Retaining blows memory fast.
- Model weights: BiRefNet ~88MB + YOLO ~13MB. Cache via `Cache API` after first load.

## Fallback ladder if budget slips

In order of applied escalations when measured performance falls short:
1. Raise K (keyframe interval) from 10 → 15.
2. Drop BiRefNet input from 512 → 384.
3. Drop flow resolution from ¼ → ⅛.
4. Skip source-color sampling (one fewer texture readback).
5. Halve interior Poisson target count.

All reversible; exposed as a `"quality: high | balanced | fast"` pref.

## Measurement

- Instrument each stage with `performance.mark` / `measure`.
- Expose a hidden `?perf=1` query flag that renders a dev HUD showing per-stage ms + rolling averages.
- Treat this as first-class: you can't hit the budget without measuring it.
