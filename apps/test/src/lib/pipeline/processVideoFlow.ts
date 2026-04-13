import { detectCurrentFrame, setFrameForDetection } from "@/lib/detect";
import type { Detection, SeedPoint } from "@/lib/detect";
import { propagateMeshFrame, rgbaToGray } from "@/lib/flow";
import { buildMeshForFrame } from "@/lib/mesh";
import type { FrameState, Mesh } from "@/lib/mesh";
import type { Density } from "@/state/pipeline";

export type FlowFramePacket = {
    frameIndex: number;
    totalFrames: number;
    width: number;
    height: number;
    bitmap: ImageBitmap;
    detection: Detection | null;
    reason: "ok" | "locator-miss" | "segment-failed" | "seed-invalid";
    mesh: Mesh | null;
    frame: FrameState | null;
    isKeyframe: boolean;
};

export type FlowProcessOptions = {
    file: File;
    density: Density;
    seed: SeedPoint | null;
    baseMesh: Mesh;
    baseFrame: FrameState;
    maxDimension: number;
    fps?: number;
    startFrame?: number;
    // Set to 0 or a negative value to disable periodic keyframes.
    keyframeInterval?: number;
    signal?: AbortSignal;
    onStart: (meta: { totalFrames: number; width: number; height: number }) => void;
    onFrame: (packet: FlowFramePacket) => Promise<void> | void;
};

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException("Flow processing aborted", "AbortError");
    }
}

function onceVideoEvent(
    video: HTMLVideoElement,
    event: "loadedmetadata" | "loadeddata" | "seeked",
    signal?: AbortSignal,
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Flow processing aborted", "AbortError"));
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
            reject(new DOMException("Flow processing aborted", "AbortError"));
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

export async function processVideoFlow(options: FlowProcessOptions): Promise<void> {
    const fps = options.fps ?? 30;
    const startFrame = Math.max(0, options.startFrame ?? 1);
    const keyframeInterval = options.keyframeInterval ?? 0;

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
        if (!context) {
            throw new Error("Unable to create video decode context");
        }

        const totalFrames = Math.max(1, Math.round(video.duration * fps));
        options.onStart({ totalFrames, width, height });

        let activeMesh = options.baseMesh;
        let activeFrame: FrameState = {
            keyframeId: options.baseFrame.keyframeId,
            confidence: options.baseFrame.confidence,
            vertices: new Float32Array(options.baseFrame.vertices),
        };
        let activeKeyframe = activeFrame.keyframeId;

        const previousFrameIndex = Math.max(0, startFrame - 1);
        video.currentTime = Math.min(video.duration, previousFrameIndex / fps);
        await onceVideoEvent(video, "seeked", options.signal);
        context.clearRect(0, 0, width, height);
        context.drawImage(video, 0, 0, width, height);
        let previousGray = rgbaToGray(context.getImageData(0, 0, width, height));

        let forceKeyframeNext = false;

        for (let frameIndex = startFrame; frameIndex < totalFrames; frameIndex += 1) {
            throwIfAborted(options.signal);

            const targetTime = Math.min(video.duration, frameIndex / fps);
            video.currentTime = targetTime;
            await onceVideoEvent(video, "seeked", options.signal);
            throwIfAborted(options.signal);

            context.clearRect(0, 0, width, height);
            context.drawImage(video, 0, 0, width, height);

            const imageData = context.getImageData(0, 0, width, height);
            const currentGray = rgbaToGray(imageData);

            const bitmap = await createImageBitmap(canvas);
            if (options.signal?.aborted) {
                bitmap.close();
                throw new DOMException("Flow processing aborted", "AbortError");
            }

            const shouldKeyframe =
                forceKeyframeNext ||
                (keyframeInterval > 0 && frameIndex - activeKeyframe >= keyframeInterval);

            let packet: FlowFramePacket = {
                frameIndex,
                totalFrames,
                width,
                height,
                bitmap,
                detection: null,
                reason: "ok",
                mesh: null,
                frame: null,
                isKeyframe: shouldKeyframe,
            };

            if (shouldKeyframe) {
                const workerBitmap = await createImageBitmap(bitmap);
                await setFrameForDetection(workerBitmap);
                throwIfAborted(options.signal);

                const detectResult = await detectCurrentFrame(options.seed);
                packet.reason = detectResult.reason;

                if (detectResult.detection) {
                    const meshResult = buildMeshForFrame(
                        detectResult.detection.mask,
                        options.density,
                        detectResult.detection.confidence,
                        frameIndex,
                    );

                    if (meshResult) {
                        activeMesh = meshResult.mesh;
                        activeFrame = meshResult.frame;
                        activeKeyframe = frameIndex;

                        packet = {
                            ...packet,
                            detection: detectResult.detection,
                            mesh: meshResult.mesh,
                            frame: meshResult.frame,
                            reason: detectResult.reason,
                            isKeyframe: true,
                        };
                        forceKeyframeNext = false;
                    }
                }

                if (!packet.frame) {
                    const propagated = propagateMeshFrame({
                        mesh: activeMesh,
                        previousFrame: activeFrame,
                        previousGray,
                        currentGray,
                        width,
                        height,
                    });

                    activeFrame = {
                        ...propagated.frame,
                        keyframeId: activeKeyframe,
                    };

                    packet = {
                        ...packet,
                        detection: null,
                        mesh: null,
                        frame: activeFrame,
                        reason: detectResult.reason === "ok" ? "segment-failed" : detectResult.reason,
                        isKeyframe: false,
                    };
                    forceKeyframeNext = true;
                }
            } else {
                const propagated = propagateMeshFrame({
                    mesh: activeMesh,
                    previousFrame: activeFrame,
                    previousGray,
                    currentGray,
                    width,
                    height,
                });

                activeFrame = propagated.frame;
                packet = {
                    ...packet,
                    mesh: null,
                    frame: activeFrame,
                    reason: "ok",
                    isKeyframe: false,
                };

                forceKeyframeNext = propagated.forceKeyframe;
            }

            await options.onFrame(packet);
            previousGray = currentGray;
        }
    } finally {
        URL.revokeObjectURL(url);
        video.src = "";
    }
}
