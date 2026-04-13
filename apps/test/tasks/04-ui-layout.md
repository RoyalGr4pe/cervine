# 04 — UI Layout

## Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                            App Shell                            │
├──────────────────────────┬──────────────────────────────────────┤
│ LEFT (360–400px)         │ RIGHT (flex: 1)                      │
│                          │                                      │
│  ┌────────────────────┐  │  ┌────────────────────────────────┐  │
│  │ Uploader           │  │  │                                │  │
│  │ (drag/drop + btn)  │  │  │                                │  │
│  └────────────────────┘  │  │     Live preview canvas        │  │
│                          │  │     (wireframe streaming)      │  │
│  ┌────────────────────┐  │  │                                │  │
│  │ Controls           │  │  │                                │  │
│  │  • Line color      │  │  └────────────────────────────────┘  │
│  │  • Line width      │  │  ┌────────────────────────────────┐  │
│  │  • Use source color│  │  │ Transport: ◀◀ ▶ ⏸ ▶▶ ─●───     │  │
│  │  • Background color│  │  └────────────────────────────────┘  │
│  │  • Density         │  │  ┌────────────────────────────────┐  │
│  │                    │  │  │ Progress:                      │  │
│  │ [Export]           │  │  │  Detecting ▓▓▓▓▓░░  18/180    │  │
│  └────────────────────┘  │  └────────────────────────────────┘  │
└──────────────────────────┴──────────────────────────────────────┘
```

## Behavior

### On upload
1. File accepted → immediately start decoding into the frame ring buffer.
2. **In parallel**, begin ONNX session warmup (hide the cost behind decode).
3. When frame 0 + model are both ready, detect + triangulate → first wireframe appears on the right.
4. Detection/propagation runs ahead of playback; user sees frames fill in as they complete.

### Tap-to-seed mode (detection fallback)
If the locator fails to find the subject on frame 0 (see [01-detection.md](./01-detection.md#tap-to-seed-fallback-when-yolo-misses)):
- Right-side preview dims frame 0 and shows caption *"Tap the object you want to isolate."*
- User clicks once → pipeline resumes with the seed point.
- Controls panel gains a **"Change subject"** button that clears the seed and re-enters seed mode.
- Seed state lives in `PipelineState.seedPoint: {x, y} | null`.

### Live preview rendering
- Canvas2D on the right, sized to video aspect.
- As each frame's mesh lands, it's pushed to a `renderQueue`.
- Playback is decoupled from processing: the user can scrub the transport bar; if they scrub to a not-yet-processed frame we show the nearest-ready frame and flag "processing..." until it catches up.

### Controls (all live-applied, no reprocess needed — rendering is cheap)
- **Line color** — color picker + "use source color" checkbox. When enabled, each edge samples the source video's pixel color at its midpoint, averaged (cached per frame).
- **Line width** — 0.5 to 4px slider.
- **Background color** — color picker; default **#000000** (black) in editor. On export, replaced with transparent unless user opted in to keep it.
- **Triangle density** — low/medium/high → controls Poisson-disk target count (requires re-triangulation of existing keyframes; runs in background).

### Export button
- Opens modal: format (WebM VP9 + alpha / PNG sequence / MP4 ProRes via `webm`-to-MP4 pipeline), resolution, background (transparent default).
- Uses `VideoEncoder` (WebCodecs) on the render canvas with `alpha: "keep"` for WebM+alpha.
- See [05-rendering-export.md](./05-rendering-export.md).

## Component tree

```
app/
  page.tsx                 // layout shell, hosts context providers
  components/
    Uploader.tsx
    Controls.tsx
    Preview.tsx            // renders the wireframe canvas + transport
    Transport.tsx
    ProgressBar.tsx
    ExportDialog.tsx
  state/
    usePipeline.ts         // zustand/reducer — exposes frames, progress, settings
    workers.ts             // spins up detect/flow/mesh workers
```

## State model (sketch)

```ts
type PipelineState = {
  status: 'idle' | 'uploading' | 'processing' | 'ready' | 'error';
  totalFrames: number;
  processedFrames: number;
  keyframes: Map<number, Mesh>;
  frames: Map<number, FrameState>;   // vertices per frame
  settings: {
    lineColor: string;
    useSourceColor: boolean;
    lineWidth: number;
    backgroundColor: string;
    density: 'low' | 'medium' | 'high';
  };
  seedPoint: { x: number; y: number } | null;   // set by tap-to-seed; persists for re-detects
  needsSeed: boolean;                            // true when locator failed and we're waiting on a tap
  playback: { currentFrame: number; playing: boolean };
};
```

## Notes
- Keep the UI framework minimal — this is Next 16 + React 19; no heavy UI lib needed. Tailwind v4 (already configured) for styling; a few shadcn-style primitives if useful.
- Uploader accepts mp4/mov/webm up to ~200MB. Reject 4K+ by default; offer a downscale-to-1080p toggle.
