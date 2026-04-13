# 07 — Implementation Phases

Strict ordering. Each phase ships a working, measurable checkpoint. Don't skip ahead — detection must be right before we invest in animation.

## Phase 0 — Scaffolding (½ day)
- Add deps: `onnxruntime-web`, `delaunator`, `fflate`, `webm-muxer`, `zustand` (or use React 19's built-in state — decide during impl).
- Set up `src/lib/` directory structure from [01](./01-detection.md), [02](./02-triangulation.md), [03](./03-animation.md), [05](./05-rendering-export.md).
- Wire Next 16 app with shell layout (no functionality yet) per [04](./04-ui-layout.md).
- Add `?perf=1` HUD skeleton.
- **Checkpoint:** blank UI loads, workers spin up, ONNX session initializes on a button click.

## Phase 1 — Single-frame detection (1 day)
- Implement `src/lib/detect/session.ts` with WebGPU→WASM fallback.
- Implement `locator.ts` (YOLOv8n) + `segmenter.ts` (BiRefNet-lite) + `seed.ts` (tap-to-seed).
- Wire the tap-to-seed UX path: when locator returns null, UI enters seed mode; on click, `seed.ts` produces a crop for the segmenter.
- Upload flow: decode frame 0, run detection (or seed prompt), display mask as a gray overlay on the right.
- **Checkpoint:** upload a video, see a correct foreground mask for frame 0 in < 1.5s. Tap-to-seed works for at least one non-COCO subject (deer/fox fixture). Accuracy gate: visually inspect on ≥ 10 animal/object test clips (store them in `apps/test/tests/fixtures/`). Must look clean on ≥ 9/10 before proceeding.

## Phase 2 — Single-frame triangulation (½ day)
- Implement marching squares, DP simplification, detail map, Poisson, Delaunay.
- Render wireframe on right canvas for frame 0.
- **Checkpoint:** uploading a video shows a wireframe for frame 0 within 1.5s. Looks like the reference deer.

## Phase 3 — Multi-frame with naïve per-frame detection (½ day)
- Loop Phase 1+2 over every frame. Slow but correct.
- Progress bar + live-append to render queue.
- **Checkpoint:** end-to-end works for a 6s clip. Measure total time. Confirms correctness baseline before we optimize.

## Phase 4 — Optical flow propagation (1 day)
- Implement DIS flow (WASM port or vendored OpenCV subset). Validate against fixtures.
- Swap non-keyframe detection for flow-based propagation at K=10.
- Add flip detection, Laplacian smoothing, EMA.
- **Checkpoint:** 6s video processes in ≤ 10s. Visually smooth animation. Compare side-by-side with Phase 3 baseline to confirm quality parity on 5 fixtures.

## Phase 5 — Adaptive keyframing + patching (½ day)
- Add FB-error confidence, adaptive K, flip-triggered keyframes.
- Implement mesh patch-and-local-retriangulate from [02](./02-triangulation.md).
- **Checkpoint:** difficult clips (fast motion, occlusion) still look right. No visible "pop" on keyframes.

## Phase 6 — Controls + live rendering (½ day)
- Color pickers, line width, density slider, source-color mode.
- All apply live without reprocess (density triggers background re-triangulation of keyframes).
- **Checkpoint:** designer-grade control; changing line color is instant.

## Phase 7 — Export (½ day)
- WebM VP9 + alpha via VideoEncoder.
- PNG sequence + zip fallback.
- **Checkpoint:** exported WebM opens in browser with real transparency; PNGs look right in a viewer.

## Phase 8 — Polish + perf HUD + fallback ladder (½ day)
- Device detection + quality preset routing.
- Fallback ladder from [06](./06-performance-budget.md).
- Error states + friendly messaging.
- **Checkpoint:** runs on a mid-tier laptop without WebGPU inside budget.

---

## Test fixtures (build this early)

Place in `apps/test/tests/fixtures/`:
- 3 animal clips (deer, dog running, bird flying)
- 2 human clips (one full body, one close-up)
- 1 multi-object clip
- 1 static-pan clip (tests affine-only path)
- 1 fast-motion / motion-blur clip (tests propagation limits)
- 1 low-contrast clip (tests matte quality)

Gate each phase transition on these fixtures.

## Dependencies to add (initial)

```jsonc
{
  "onnxruntime-web": "^1.21.0",
  "delaunator": "^5.1.0",
  "fflate": "^0.8.2",
  "mediabunny": "^1.40.0",    // replaces deprecated webm-muxer
  "zustand": "^5.0.0"
}
```

Model weights hosted separately on the CDN; loaded via `fetch` + `Cache API` on first use.
