# 05 — Rendering & Export

## Live render (Canvas2D)

Per frame:
1. Clear canvas to `settings.backgroundColor` (default `#000`).
2. Fetch `FrameState` → vertices (Float32Array).
3. Iterate `mesh.edges` (shared across the keyframe):
   - Compute `x0,y0` and `x1,y1` from vertex buffer.
   - `strokeStyle` = `settings.useSourceColor ? sampleSourceMidpoint(frame, x0,y0,x1,y1) : settings.lineColor`.
   - `lineWidth` = `settings.lineWidth`.
   - `stroke()` the line.

Target: **≤ 3ms per frame** for ~1500 edges.

### Source-color sampling
- On each decoded frame, build a small downsampled RGB buffer (e.g. 480×270) once.
- For each edge, sample the midpoint and use the RGB as stroke color.
- Cache per-frame to avoid re-sampling when the user just toggles width/color.

### Why Canvas2D not WebGL?
- At ~1500 lines/frame Canvas2D is fast enough and simpler.
- If we ever need 10k+ edges or advanced blending, switch to a thin WebGL line renderer — not a phase-1 concern.

## Export

### Formats
| Format | Transparency | Tradeoff |
|---|---|---|
| **WebM VP9 + alpha** | ✅ native | Best quality; not all players support. Use as default. |
| PNG sequence (zip) | ✅ per-frame | Heavy; reliable interop (After Effects, editors). |
| MP4 H.264 | ❌ | Fallback with solid bg; smaller files. |
| GIF | ❌ | Tiny previews only. |

### Pipeline
- `OffscreenCanvas` matching source video resolution (render target).
- `VideoEncoder` (WebCodecs):
  - VP9 codec, `alpha: 'keep'`, bitrate tuned by resolution.
  - Feed frames by re-rendering each processed `FrameState` into the canvas with the export-time background (transparent default).
- Mux with **Mediabunny** (the successor to the deprecated `webm-muxer` — same author, broader container/codec support) to produce a final `.webm` blob.
- PNG sequence: iterate frames → `canvas.convertToBlob({ type: 'image/png' })` → zip via `fflate`.

### Background on export
- Default: **transparent** (clear canvas with `clearRect`).
- User override: checkbox "keep editor background" → solid-fill first.

### Performance target for export
- Render + encode should be real-time-ish on WebGPU devices: 6s video exported in ≤ 8s.
- Run off the UI thread in a worker with `OffscreenCanvas` + `VideoEncoder`.

## Implementation skeleton

```
apps/test/src/lib/render/
  ├─ drawMesh.ts          // Canvas2D / OffscreenCanvas wireframe draw
  ├─ sampleSourceColor.ts
  └─ export/
      ├─ webmVp9Alpha.ts   // VideoEncoder + mediabunny muxer
      ├─ pngSequence.ts    // per-frame PNG + fflate zip
      └─ index.ts
```
