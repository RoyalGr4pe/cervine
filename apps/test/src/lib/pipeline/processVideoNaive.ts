import { detectCurrentFrame, setFrameForDetection } from "@/lib/detect";
import type { SeedPoint } from "@/lib/detect";
import { buildMeshForFrame } from "@/lib/mesh";
import type { Detection } from "@/lib/detect";
import type { Mesh, FrameState } from "@/lib/mesh";
import type { Density } from "@/state/pipeline";

type FramePacket = {
    frameIndex: number;
    totalFrames: number;
    width: number;
    height: number;
    bitmap: ImageBitmap;
    detection: Detection | null;
    reason: "ok" | "locator-miss" | "segment-failed" | "seed-invalid";
    mesh: Mesh | null;
    frame: FrameState | null;
};

export type NaiveProcessOptions = {
    file: File;
    density: Density;
    seed: SeedPoint | null;
    maxDimension: number;
    fps?: number;
    startFrame?: number;
    signal?: AbortSignal;
    onStart: (meta: { totalFrames: number; width: number; height: number }) => void;
    onFrame: (packet: FramePacket) => Promise<void> | void;
};

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException("Naive processing aborted", "AbortError");
    }
}

function onceVideoEvent(
    video: HTMLVideoElement,
    event: "loadedmetadata" | "loadeddata" | "seeked",
    signal?: AbortSignal,
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Naive processing aborted", "AbortError"));
            return;
        }

        if (event === "loadedmetadata" && video.readyState >= 1) {
            resolve();
            return;
        }
        if (event === "loadeddata" && video.readyState >= 2) {
            resolve();
            return;
        }

        const onResolve = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error("Unable to decode uploaded video"));
        };
        const onAbort = () => {
            cleanup();
            reject(new DOMException("Naive processing aborted", "AbortError"));
        };
        const cleanup = () => {
            video.removeEventListener(event, onResolve);
            video.removeEventListener("error", onError);
            signal?.removeEventListener("abort", onAbort);
        };

        video.addEventListener(event, onResolve, { once: true });
        video.addEventListener("error", onError, { once: true });
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export async function processVideoNaive(options: NaiveProcessOptions): Promise<void> {
    const fps = options.fps ?? 30;
    const startFrame = Math.max(0, options.startFrame ?? 0);
    const url = URL.createObjectURL(options.file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    try {
        throwIfAborted(options.signal);
        await onceVideoEvent(video, "loadedmetadata", options.signal);
        await onceVideoEvent(video, "loadeddata", options.signal);

        const srcWidth = Math.max(1, video.videoWidth);
        const srcHeight = Math.max(1, video.videoHeight);
        const scale = Math.min(1, options.maxDimension / Math.max(srcWidth, srcHeight));
        const width = Math.max(1, Math.round(srcWidth * scale));
        const height = Math.max(1, Math.round(srcHeight * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Unable to create video decode context");

        const totalFrames = Math.max(1, Math.round(video.duration * fps));
        options.onStart({ totalFrames, width, height });

        for (let frameIndex = startFrame; frameIndex < totalFrames; frameIndex += 1) {
            throwIfAborted(options.signal);

            const targetTime = Math.min(video.duration, frameIndex / fps);
            video.currentTime = targetTime;
            await onceVideoEvent(video, "seeked", options.signal);
            throwIfAborted(options.signal);

            context.clearRect(0, 0, width, height);
            context.drawImage(video, 0, 0, width, height);

            const bitmap = await createImageBitmap(canvas);
            const workerBitmap = await createImageBitmap(bitmap);
            await setFrameForDetection(workerBitmap);
            throwIfAborted(options.signal);

            const detectResult = await detectCurrentFrame(options.seed);

            const meshResult = detectResult.detection
                ? buildMeshForFrame(
                    detectResult.detection.mask,
                    options.density,
                    detectResult.detection.confidence,
                    frameIndex,
                )
                : null;

            await options.onFrame({
                frameIndex,
                totalFrames,
                width,
                height,
                bitmap,
                detection: detectResult.detection,
                reason: detectResult.reason,
                mesh: meshResult?.mesh ?? null,
                frame: meshResult?.frame ?? null,
            });
        }
    } finally {
        URL.revokeObjectURL(url);
        video.src = "";
    }
}
