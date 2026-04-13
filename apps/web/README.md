# Cervine Web: Detection to Dot Grid

This app turns an uploaded video into a dot-based animation by detecting the foreground object in each frame, then sampling that object on a moving grid.

## High-Level Flow

1. Upload a video in the UI.
2. Adjust settings:
   - Threshold (foreground sensitivity)
   - Spacing (distance between dots)
   - Dot size (render-only)
   - Dot color (source pixel color or fixed color)
   - Display mode (dots or delaunay)
   - Delaunay line width + color strategy
3. Live transformed preview updates immediately after upload and while tuning settings.
4. Process all frames into a dot animation.
5. Play, scrub, and export the result as WebM.

## Detection Pipeline

Each frame starts as `ImageData` from an off-screen canvas.

1. Background estimate
   - A background RGB color is estimated from border pixels.
   - During full processing, this is sampled once from the first frame and reused.

2. Foreground mask
   - For each pixel, a robust score is computed from:
     - squared RGB distance from background
     - normalized chroma distance
     - optional motion-assist using previous-frame luma difference
   - Pixel is foreground when this combined score passes the threshold logic.

3. Mask cleanup (morphological close)
   - Dilation then erosion are applied.
   - Implementation uses separable 1D passes with running sums for speed.

4. Object extraction
   - Live preview path uses full detection:
     - keeps the largest connected blob
     - computes contour, centroid, and bounding box
   - Batch processing path uses a fast variant:
     - skips contour tracing and largest-blob filtering
     - uses cleaned mask + centroid directly

5. Small-object rejection
   - If detected foreground is too small (< 0.5% of frame), frame is treated as no object.

6. Dot tracking
   - Processed dot frames are matched frame-to-frame using nearest-neighbor gating.
   - Stable IDs, velocity, and fade TTL reduce hard pop-in/pop-out behavior.

## Dot Grid Conversion

For each processed frame:

1. A grid is laid out with step size = `spacing`.
2. Grid origin is snapped to object centroid:
   - `originX = ((centroid.x % spacing) + spacing) % spacing`
   - `originY = ((centroid.y % spacing) + spacing) % spacing`
   - This keeps the dot lattice visually centered on the moving object.
3. Grid points inside the foreground mask become dots.
4. Dot color comes from either:
   - source pixel RGB at that point, or
   - fixed UI-selected hex color.

Output frame format is an array of dots:

```ts
type Dot = { x: number; y: number; r: number; g: number; b: number };
```

The full animation is:

```ts
type DotAnimation = {
  frames: Dot[][];
  fps: number; // currently 30
  frameCount: number;
  videoWidth: number;
  videoHeight: number;
};
```

## Runtime + UI Notes

- Processing samples frames at a target 30 FPS.
- Idle mode now shows live transformed preview (no need to process first to see changes).
- Preview updates continuously during playback and reacts to settings changes.
- Render mode can be switched between dots and delaunay for preview, processing preview, and final player/export.
- Progress UI renders the latest processed dot frame while batch processing runs.
- Processing supports cancellation through `AbortController`.
- Final animation player supports play/pause, restart, frame scrubbing, and WebM export via `MediaRecorder`.

## Where Logic Lives

- Web orchestration/UI: `apps/web/app/components`
- Core frame extraction + detection + processing: `packages/video-core/src`

If you are tuning quality vs speed, start with `threshold` and `spacing` first.
