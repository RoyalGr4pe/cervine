# Detection Investigation (Task 8)

## Goal

Improve object detection reliability when scenes contain strong color variation.

## Candidate Methods Evaluated

1. Temporal background model (running average/median)

- Pros: strong for static camera + stable background.
- Cons: slower warm-up, can absorb slow-moving foreground into background, more state handling.

2. Chroma/luma-aware thresholding

- Pros: better separation when RGB distance alone is ambiguous; robust to brightness shifts.
- Cons: requires tuning weight between RGB and chroma channels.

3. Motion-assisted mask fusion

- Pros: recovers moving foreground in difficult color regions.
- Cons: less useful for near-static subjects.

## Selected Strategy

Primary method:

- Chroma/luma-aware score (RGB distance + normalized chroma distance)

Fallback/assist:

- Motion-assisted inclusion using previous-frame luma difference
- Dynamic border-color blend (initial background + per-frame border sample)

## Fully Client-Side Model Mode

Implemented in the web app as an optional detector mode:

1. `ML (client)` uses an in-browser segmentation model via `@imgly/background-removal`.
2. No backend inference is required.
3. Preview and processing both support this mode, with fallback to classic detection if ML inference fails.

## Why This Was Selected

1. Minimal architecture disruption: drops into existing fast detector path.
2. Better robustness in colorful scenes without replacing the full pipeline.
3. Keeps processing cost in acceptable range.

## Benchmark Snapshot

Pre-robust report:

- [tasks/baselines/detection-baseline-pre-robust.md](tasks/baselines/detection-baseline-pre-robust.md)

Post-robust report:

- [tasks/baselines/detection-baseline-post-robust.md](tasks/baselines/detection-baseline-post-robust.md)

Observed change summary:

1. Simple and colorful clip detection success remained 100%.
2. Motion clip detection success remained 91.11% in synthetic benchmark.
3. Average ms/frame stayed in the same practical range.

## Next Validation

1. Run the same benchmark against real user clips with cluttered/colorful backgrounds.
2. Tune chroma weighting and motion threshold from those real-world cases.

## Lightweight Client-Side Model Shortlist

1. MediaPipe Selfie Segmentation (MobileNetV3)

- Very fast on browser/mobile hardware.
- Best for person-centric content, less ideal for arbitrary wildlife/objects.

2. DeepLabv3 MobileNet variants (TensorFlow.js / TFLite / ONNX)

- General semantic segmentation with low resource footprint.
- Quality depends on class coverage and scene type.

3. MODNet (ONNX Web)

- Good portrait matting quality and speed.
- Primarily tuned for human foreground.

4. ISNet quantized variants (current path via `@imgly/background-removal`)

- Category-agnostic foreground extraction.
- Works fully client-side and is practical with downscaled inference.

## Recommended Method For Cervine

Use a hybrid video pipeline to avoid UI freezes while maintaining quality:

1. Frame candidate mask:

- Run lightweight classical detector every frame (cheap baseline mask).

2. ML refinement at low frequency:

- Run quantized client-side model every N frames (for example, every 3rd to 6th frame in preview, every 2nd to 3rd in processing).
- Run ML on downscaled frames (for example max side 256-384), then upsample mask.

3. Temporal propagation between ML frames:

- Reuse last ML mask for intermediate frames, adjusted by centroid/motion cues from classical detector.

4. Post-process:

- Morphological close + largest-blob selection.

5. Dot/mesh generation:

- Apply grid sampling only inside final mask, then render dots or Delaunay.

This gives the sequence you suggested in practice: extract object mask per frame, remove background/segment foreground periodically with ML, then apply mesh generation.
