import { extractFrame } from "./extractFrame";
import {
    sampleBorderColor,
    detectObjectFast,
    closeMask,
    keepLargestBlob,
} from "./detectObject";
import { trackDotFrames } from "./trackDots";
import type { TrackedDot } from "./trackDots";

export interface Dot {
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
}

export interface DotAnimation {
    frames: Dot[][];
    trackedFrames?: TrackedDot[][];
    fps: number;
    frameCount: number;
    videoWidth: number;
    videoHeight: number;
}

export interface ProcessOptions {
    threshold?: number;
    spacing?: number;
    /** Sampling lattice for point generation. */
    samplingPattern?: "grid" | "triangular";
    /** Fixed colour. When null, sample from source pixel. */
    dotColor?: string | null;
    tracking?: {
        enabled?: boolean;
        maxMatchDistance?: number;
        despawnTTL?: number;
    };
    detectorMode?: "classic" | "ml";
    mlMaskProvider?: (
        frame: ImageData,
        options?: { fastPreview?: boolean }
    ) => Promise<Uint8Array | null>;
    onProgress?: (framesProcessed: number, total: number, latestDots: Dot[]) => void;
    /** Signal to abort early */
    signal?: AbortSignal;
}

function centroidFromMask(mask: Uint8Array, width: number, height: number): { x: number; y: number; count: number } {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        sumX += i % width;
        sumY += (i / width) | 0;
        count++;
    }
    if (count === 0) return { x: 0, y: 0, count: 0 };
    return { x: sumX / count, y: sumY / count, count };
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
        samplingPattern = "grid",
        dotColor = null,
        tracking,
        detectorMode = "classic",
        mlMaskProvider,
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
    let prevFrame: ImageData | null = null;
    const mlKeyframeInterval = detectorMode === "ml" ? 3 : 1;

    // Sample background colour once from the first frame — it doesn't change.
    await seekTo(video, 0);
    const firstFrame = extractFrame(video);
    const bg = firstFrame ? sampleBorderColor(firstFrame) : { r: 128, g: 128, b: 128 };

    for (let i = 0; i < frameCount; i++) {
        if (signal?.aborted) break;

        await seekTo(video, i / fps);

        const frame = extractFrame(video);
        if (!frame) {
            frames.push([]);
            onProgress?.(i + 1, frameCount, []);
            prevFrame = null;
            continue;
        }

        // Fast path: no contour trace, bg already known
        const frameBg = sampleBorderColor(frame, 4);
        const blendedBg = {
            r: Math.round(bg.r * 0.65 + frameBg.r * 0.35),
            g: Math.round(bg.g * 0.65 + frameBg.g * 0.35),
            b: Math.round(bg.b * 0.65 + frameBg.b * 0.35),
        };

        let mask: Uint8Array | null = null;
        let centroid: { x: number; y: number } | null = null;

        if (
            detectorMode === "ml" &&
            mlMaskProvider &&
            (i % mlKeyframeInterval === 0 || i === 0)
        ) {
            const mlMask = await mlMaskProvider(frame);
            if (mlMask && mlMask.length === vw * vh) {
                const cleaned = closeMask(mlMask, vw, vh, 4);
                const blob = keepLargestBlob(cleaned, vw, vh);
                const c = centroidFromMask(blob, vw, vh);
                if (c.count >= vw * vh * 0.005) {
                    mask = blob;
                    centroid = { x: c.x, y: c.y };
                }
            }
        }

        if (!mask || !centroid) {
            const result = detectObjectFast(frame, blendedBg, threshold, prevFrame);
            if (!result) {
                frames.push([]);
                onProgress?.(i + 1, frameCount, []);
                prevFrame = frame;
                continue;
            }
            mask = result.mask;
            centroid = result.centroid;
        }

        const src = frame.data;
        const dots: Dot[] = [];

        const originX = ((centroid.x % spacing) + spacing) % spacing;
        const originY = ((centroid.y % spacing) + spacing) % spacing;
        const useTriangularSampling = samplingPattern === "triangular";

        for (let y = originY, row = 0; y < vh; y += spacing, row++) {
            const rowOffset = useTriangularSampling && row % 2 === 1
                ? spacing * 0.5
                : 0;

            for (let x = originX + rowOffset - spacing; x < vw; x += spacing) {
                const ix = Math.round(x);
                const iy = Math.round(y);
                if (ix < 0 || ix >= vw || iy < 0 || iy >= vh) continue;
                if (!mask[iy * vw + ix]) continue;

                const p = (iy * vw + ix) * 4;
                dots.push({
                    x: ix,
                    y: iy,
                    r: fixedRGB ? fixedRGB.r : (src[p] ?? 0),
                    g: fixedRGB ? fixedRGB.g : (src[p + 1] ?? 0),
                    b: fixedRGB ? fixedRGB.b : (src[p + 2] ?? 0),
                });
            }
        }

        frames.push(dots);
        onProgress?.(i + 1, frameCount, dots);
        prevFrame = frame;

        // Yield every frame so the preview canvas can update
        await new Promise((r) => setTimeout(r, 0));
    }

    // Restore video state
    if (!wasPaused) video.play().catch(() => { });

    const trackedFrames = tracking?.enabled === false
        ? undefined
        : trackDotFrames(frames, {
            maxMatchDistance: tracking?.maxMatchDistance ?? spacing * 1.75,
            despawnTTL: tracking?.despawnTTL ?? 2,
        });

    return {
        frames,
        trackedFrames,
        fps,
        frameCount: frames.length,
        videoWidth: vw,
        videoHeight: vh,
    };
}
