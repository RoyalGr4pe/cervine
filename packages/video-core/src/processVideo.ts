import { extractFrame } from "./extractFrame";
import { sampleBorderColor, detectObjectFast } from "./detectObject";

export interface Dot {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
}

export interface DotAnimation {
  frames: Dot[][];
  fps: number;
  frameCount: number;
  videoWidth: number;
  videoHeight: number;
}

export interface ProcessOptions {
  threshold?: number;
  spacing?: number;
  /** Fixed colour. When null, sample from source pixel. */
  dotColor?: string | null;
  onProgress?: (framesProcessed: number, total: number, latestDots: Dot[]) => void;
  /** Signal to abort early */
  signal?: AbortSignal;
}

/** Parse a CSS hex colour string into {r,g,b}. */
function parseHex(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const int = parseInt(clean, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

/** Seek the video to time t and resolve once seeked. */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 0.001) { resolve(); return; }
    const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = t;
  });
}

/**
 * Processes every frame of the video and returns a DotAnimation.
 *
 * For each frame:
 *   1. Seek to frame timestamp
 *   2. Extract ImageData
 *   3. Detect object mask + centroid
 *   4. Snap the dot grid to the object centroid so dots stay centred on the object
 *   5. Collect all dots whose grid cell falls inside the mask
 */
export async function processVideo(
  video: HTMLVideoElement,
  opts: ProcessOptions = {}
): Promise<DotAnimation> {
  const {
    threshold = 60,
    spacing = 12,
    dotColor = null,
    onProgress,
    signal,
  } = opts;

  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) {
    throw new Error("Video has no valid duration");
  }

  // Estimate fps from the video element if possible, else assume 30
  // (HTMLVideoElement doesn't expose fps directly; we'll sample at 30fps max)
  const TARGET_FPS = 30;
  const frameCount = Math.round(duration * TARGET_FPS);
  const fps = TARGET_FPS;

  const vw = video.videoWidth;
  const vh = video.videoHeight;

  const wasPaused = video.paused;
  if (!wasPaused) video.pause();

  const fixedRGB = dotColor ? parseHex(dotColor) : null;
  const frames: Dot[][] = [];

  // Sample background colour once from the first frame — it doesn't change.
  await seekTo(video, 0);
  const firstFrame = extractFrame(video);
  const bg = firstFrame ? sampleBorderColor(firstFrame) : { r: 128, g: 128, b: 128 };

  for (let i = 0; i < frameCount; i++) {
    if (signal?.aborted) break;

    await seekTo(video, i / fps);

    const frame = extractFrame(video);
    if (!frame) { frames.push([]); onProgress?.(i + 1, frameCount, []); continue; }

    // Fast path: no contour trace, no blob filter, bg already known
    const result = detectObjectFast(frame, bg, threshold);
    if (!result) { frames.push([]); onProgress?.(i + 1, frameCount, []); continue; }

    const { mask, centroid } = result;
    const src = frame.data;
    const dots: Dot[] = [];

    const originX = ((centroid.x % spacing) + spacing) % spacing;
    const originY = ((centroid.y % spacing) + spacing) % spacing;

    for (let y = originY; y < vh; y += spacing) {
      for (let x = originX; x < vw; x += spacing) {
        const ix = Math.round(x);
        const iy = Math.round(y);
        if (ix < 0 || ix >= vw || iy < 0 || iy >= vh) continue;
        if (!mask[iy * vw + ix]) continue;

        const p = (iy * vw + ix) * 4;
        dots.push({
          x: ix,
          y: iy,
          r: fixedRGB ? fixedRGB.r : (src[p]     ?? 0),
          g: fixedRGB ? fixedRGB.g : (src[p + 1] ?? 0),
          b: fixedRGB ? fixedRGB.b : (src[p + 2] ?? 0),
        });
      }
    }

    frames.push(dots);
    onProgress?.(i + 1, frameCount, dots);

    // Yield every frame so the preview canvas can update
    await new Promise((r) => setTimeout(r, 0));
  }

  // Restore video state
  if (!wasPaused) video.play().catch(() => {});

  return { frames, fps, frameCount: frames.length, videoWidth: vw, videoHeight: vh };
}
