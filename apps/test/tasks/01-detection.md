# 01 — Object Detection (the sacred path)

Everything depends on a clean foreground mask. This file plans that step end-to-end.

## Requirement restated

Given an arbitrary uploaded video whose subject may be a person, animal, vehicle, or other salient object, produce a per-keyframe foreground mask accurate enough that its outline + interior sampling produces a recognizable wireframe.

## Model selection

Evaluated options (all browser-deployable):

| Model | Task | Size | Animal quality | Speed (WebGPU) | Notes |
|---|---|---|---|---|---|
| **BiRefNet-lite** | Dichotomous/salient seg | ~88MB | Excellent | ~80–120ms @ 512² | Purpose-built for fine-edge foreground matting. Best accuracy/edge quality tradeoff. |
| **RMBG-1.4 (BRIA)** | Background removal | ~176MB | Very good | ~100–150ms @ 1024² | Licensed for non-commercial by default; check before shipping. Gorgeous hair/fur edges. |
| MediaPipe ImageSegmenter | General seg | ~10MB | Weak on animals | ~20ms | Tempting but category-biased. Skip. |
| YOLOv8n-seg | Instance seg | ~14MB | Good (known classes) | ~30ms | Fails on unseen categories. Useful as a **locator** only. |
| SAM2-tiny (EdgeSAM / MobileSAM) | Prompt seg | ~40MB | Excellent with a prompt | ~60ms after encode | Needs a point/box prompt. Expensive image encode per keyframe (~200ms). |

**Decision: BiRefNet-lite as primary, YOLOv8n-seg as a fast locator to crop the input to the object bounding box before segmenting.** Two-stage pays off because BiRefNet at 512² on a tight crop is much sharper than at 512² on a full frame.

Fallback chain:
1. WebGPU + BiRefNet-lite (primary)
2. WASM-SIMD + BiRefNet-lite (older browsers; ~3–4× slower)
3. Transformers.js + `Xenova/rmbg-1.4` as a last resort (largest download)

## First-frame pipeline (the one the user sees land first)

Target: **first triangulated render within 1.5s of upload finishing**.

1. **Extract frame 0** via WebCodecs (parallel to model warmup). ~50ms.
2. **Warm model** — during video upload/decode, eagerly initialize the ONNX session so weights are on GPU by the time frame 0 arrives. ~600ms one-time cost that overlaps with user's upload wait.
3. **YOLOv8n locator pass** on frame 0 at 320². ~25ms. Take the highest-confidence non-background box; expand by 15%.
4. **BiRefNet on the crop** resized to 512². ~100ms WebGPU.
5. **Upscale mask** back to crop coords via bilinear, then paste into full-frame α buffer. ~5ms.
6. **Mask cleanup** — single-pass morphological open (3×3) + largest-connected-component filter to kill speckle. ~5ms.
7. Hand mask to triangulation (see [02](./02-triangulation.md)).

Total budget for first frame end-to-end: **≤ 250ms after model warmup**.

## Keyframe strategy (frames 1..N-1)

Don't re-run detection every frame — that's the budget killer. Run it every **K frames** where K starts at 10 and is adaptive.

Keyframe triggers (any of):
- `frameIndex % K == 0`
- Flow confidence from propagation drops below threshold (median forward-backward error > 2px)
- Mesh bounding box drifts > 25% in one frame (discontinuity — cut, or fast motion)
- User scrubs backward past the last keyframe

Budget per keyframe (crop+segment+cleanup): **≤ 120ms** on WebGPU.

For a 6s video at 30fps with K=10: ~18 keyframes × 120ms = **2.2s of detection work**. Rest of the budget spent on decode (free), flow (~180 frames × 8ms = 1.4s), triangulate (~18 × 15ms = 0.27s), render (~180 × 3ms = 0.54s). **Total ≈ 4.5s for 6s video** — well inside budget.

## Multi-object handling

First cut: **largest connected component only**. Extra objects in the scene are dropped after CC-filter.

V2 (behind a flag, not in first phase): keep the top-N components above an area threshold, triangulate each as its own mesh with shared mesh IDs; animate them independently.

## Crop refinement between keyframes

To keep the locator cheap on keyframes 1+, don't re-run YOLO — derive the crop from the **current warped mesh's bounding box**, expanded by 15%. This is ~free and tracks the object through fast motion.

## Tap-to-seed fallback (when YOLO misses)

YOLOv8n on COCO handles common animals (dog, cat, horse, sheep, cow, bird, elephant, bear, zebra, giraffe) but misses deer, fox, rabbit, squirrel, reptiles, insects, and most non-animal salient subjects. When this happens we need a human-in-the-loop fallback — but it must stay **optional** and **non-blocking** so the common path still feels automatic.

### Trigger

After YOLO runs on frame 0:
- If **no detection** above confidence 0.35 inside the frame, OR
- The top detection's bbox covers < 2% of frame area (probably wrong/spurious)

→ enter **seed mode**.

### UX

- Right-side preview shows frame 0 with a dimmed overlay and a caption: *"Tap the object you want to isolate."*
- User clicks/taps once on the subject.
- Click position is the **seed point** `(sx, sy)` in video coordinates.
- On mobile: same thing with tap.
- Escape/cancel → retry with full-frame BiRefNet at 512² (current "subject tiny in frame" fallback from the failure-modes table).

### Using the seed

The seed becomes a prompt for BiRefNet's crop, not a SAM-style mask prompt (BiRefNet isn't promptable). Strategy:

1. **Initial crop** = a square centered at `(sx, sy)` with side = 40% of min(frame width, height). Run BiRefNet on it at 512².
2. **Validate**: the returned mask must have a non-zero α at `(sx, sy)` itself (user clicked inside the object). If not → the crop was too small or the matte cut through; expand to 70% side and retry once.
3. **Tighten**: if the resulting mask's bounding box is well inside the crop (> 10% margin on all sides), re-run BiRefNet on a tight crop (bbox expanded 15%) for sharper edges. ~+100ms, worth it for quality on frame 0.
4. From frame 0 forward, normal keyframe logic takes over — crops are derived from the warped mesh's bbox, no more tapping needed.

### Persisting the seed

Save the seed point in pipeline state so that:
- If the pipeline restarts (refresh, reprocess) we reuse it.
- If adaptive keyframing triggers a re-detect and YOLO **still** has no confident detection, we fall back to the seed rather than asking the user again mid-video.
- A "change subject" button in the controls panel clears the seed and re-enters seed mode.

### Multi-object via multiple taps (V2, flagged)

Same mechanism with multiple seed points, each producing its own tight crop → its own mask → its own mesh. Out of scope for Phase 1.

## Failure modes & mitigations

| Failure | Cause | Mitigation |
|---|---|---|
| Mask has holes inside body | Texture confusion / camouflage | Morphological close after the model; cap at 3×3 |
| Mask leaks into background | Low contrast edges | BiRefNet's matte is soft — threshold at 0.5 but keep the α values for edge softening, not a hard binarize |
| Multiple objects merge | Overlapping subjects | CC-filter; optionally watershed with YOLO boxes as markers (V2) |
| Subject tiny in frame | YOLO misses it | Tap-to-seed mode (see below); last resort full-frame BiRefNet at 512² |
| Subject not a COCO class (deer, fox, etc.) | YOLO vocab gap | Tap-to-seed mode (see below) |
| Fast motion blur | Edge ambiguity | Oversample: run BiRefNet at the blurred frame but reuse prev keyframe's mesh topology in triangulation |

## Implementation skeleton

```
apps/test/src/lib/detect/
  ├─ session.ts          // lazy ONNX session factory (webgpu → wasm fallback)
  ├─ locator.ts          // YOLOv8n inference + nms, returns bbox or null
  ├─ seed.ts             // tap-to-seed: point → crop, validate, tighten
  ├─ segmenter.ts        // BiRefNet inference, returns Float32Array mask
  ├─ cleanup.ts          // morph open/close + largest-cc filter (pure JS / WASM)
  ├─ pipeline.ts         // orchestrates locator|seed → segment → cleanup
  └─ worker.ts           // message bus — receives VideoFrame, posts mask
```

## Models — acquisition & hosting

- Host weights from our own CDN (don't depend on HF availability at runtime).
- Quantize BiRefNet to fp16 for WebGPU (~½ size, negligible accuracy loss); int8 for WASM fallback.
- Ship a tiny preflight that picks the model variant based on `navigator.gpu` availability + device memory.

## Open questions to resolve before coding

1. ~~License check on BiRefNet-lite + RMBG-1.4~~ — **resolved:** non-commercial project, licenses are fine for this use.
2. ~~Which YOLO weights~~ — **resolved:** ship COCO YOLOv8n + **tap-to-seed** fallback for non-COCO subjects (see above).
3. **Max input resolution** — cap uploaded video at 1080p for decode cost; downscale on ingest.
