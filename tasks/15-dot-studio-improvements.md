# Dot Studio Improvements Task Pack

This plan turns your four requested improvements into a one-by-one implementation sequence.

Scope:

1. Persistent dot tracking so dots move instead of popping in and out.
2. Add an alternate Delaunay triangulation display mode.
3. Investigate and improve object detection for colorful scenes.
4. Show transformed output immediately after upload and while editing settings.

## Progress

- Completed: Task 1
- Completed: Task 2
- Completed: Task 3
- Completed: Task 4
- Completed: Task 5
- Completed: Task 6
- Completed: Task 7
- Completed: Task 8
- Completed: Task 9
- In progress: Task 10

## Execution Rules

1. Complete each task Definition of Done before starting the next.
2. Keep current exported animation format backward compatible unless explicitly changed.
3. Add toggles and fallbacks for all new rendering/detection paths.
4. Record benchmark results before and after detection changes.

## Task 1: Baseline, Metrics, and Test Clips

Goal: establish measurable baseline for quality and performance.

Work:

1. Add a small benchmark harness in video-core for frame-level detection stats.
2. Define 3 clip categories: simple background, colorful background, fast motion.
3. Capture baseline metrics: detection success rate, average dot count stability, processing ms/frame.

Definition of Done:

1. Baseline report exists in markdown with per-clip metrics.
2. We can re-run the benchmark with one command.

## Task 2: Persistent Dot Identity Tracking

Goal: keep dot continuity frame-to-frame.

Work:

1. Introduce tracked-dot model with stable id and velocity.
2. Match dots across adjacent frames using nearest-neighbor gating on position.
3. Handle unmatched dots with spawn/despawn lifecycle and TTL smoothing.

Definition of Done:

1. Dot objects keep consistent ids through normal motion.
2. Abrupt popping is reduced in side-by-side comparison with baseline.

## Task 3: Motion Animation Layer

Goal: animate dots moving up/down/left/right rather than hard frame replacement.

Work:

1. Add interpolation between tracked states for playback time.
2. Update player render loop to sample interpolated position at sub-frame time.
3. Add optional motion easing toggle for visual smoothing.

Definition of Done:

1. Dots visibly travel between positions during playback.
2. Pause, scrub, and export still work with tracked motion enabled.

## Task 4: Unified Render Mode API

Goal: support multiple visualizations from one processed result.

Work:

1. Add render mode enum: dots, delaunay.
2. Define shared frame payload consumed by both renderers.
3. Add UI mode selector in studio settings.

Definition of Done:

1. Mode can be switched without re-uploading video.
2. Existing dot mode behavior remains unchanged.

## Task 5: Delaunay Triangulation Display Mode

Goal: render triangle mesh as an alternate output.

Work:

1. Build triangulation per frame from tracked dot positions.
2. Render triangle edges or filled faces (initially edges only if needed).
3. Add controls for line width and mesh color strategy.

Definition of Done:

1. Delaunay mode renders correctly during playback.
2. Exported output matches selected mode.

## Task 6: Immediate Live Transform Preview

Goal: show transformed output right after upload, no manual process click required.

Work:

1. Start a live preview pipeline on upload using current settings.
2. Replace idle outline-only view with transformed preview canvas.
3. Keep manual full processing as explicit step for final animation export.

Definition of Done:

1. User sees transformed result immediately after video load.
2. No cancel flow is needed just to adjust settings and preview.

## Task 7: Reactive Settings Preview

Goal: allow quick tuning before full processing.

Work:

1. Apply threshold, spacing, size, and color changes to preview in near-real time.
2. Debounce expensive recomputation to keep UI responsive.
3. Show tiny status indicator: live preview, updating, ready.

Definition of Done:

1. Setting changes appear in preview quickly and consistently.
2. UI remains responsive on medium-length clips.

## Task 8: Detection Investigation Spike

Goal: evaluate stronger object detection options for colorful scenes.

Work:

1. Evaluate candidate methods:
   - temporal background model (running average or median)
   - chroma/luma separated thresholding (HSV or Lab style distance)
   - motion-assisted mask (frame differencing) combined with color mask
2. Compare candidates against Task 1 benchmark clips.
3. Choose primary method and one fallback strategy.

Definition of Done:

1. Investigation notes include quality and performance tradeoffs.
2. Selected detector approach is justified with benchmark numbers.

## Task 9: Implement Improved Detector

Goal: replace or augment current detector with selected approach.

Work:

1. Implement chosen detection method in video-core.
2. Add runtime toggle or auto-fallback for difficult scenes.
3. Tune post-processing parameters and thresholds.

Definition of Done:

1. Colorful-scene detection improves versus baseline.
2. Processing time remains acceptable for target clip sizes.

## Task 10: Stabilization, QA, and Rollout

Goal: finish safely with clear validation.

Work:

1. Add regression tests for tracking continuity and render modes.
2. Validate export for dots and delaunay outputs.
3. Update docs for new workflow and controls.

Definition of Done:

1. All acceptance checks pass.
2. README and in-app labels match implemented behavior.

## Recommended Implementation Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8
9. Task 9
10. Task 10
