/// <reference lib="webworker" />

import { detectFrame } from "@/lib/detect/pipeline";
import type { BBox, Detection, FramePixels, SeedPoint } from "@/lib/detect/types";

type SerializableDetection = {
    bbox: BBox;
    confidence: number;
    source: Detection["source"];
    mask: {
        width: number;
        height: number;
        data: ArrayBuffer;
    };
};

export type DetectInMsg =
    | { type: "ping" }
    | { type: "init-session"; modelUrl: string }
    | { type: "set-frame"; requestId: string; bitmap: ImageBitmap }
    | { type: "detect-frame"; requestId: string; seed: SeedPoint | null };

export type DetectOutMsg =
    | { type: "ready" }
    | { type: "pong" }
    | { type: "session-ready"; provider: string }
    | { type: "frame-set"; requestId: string; width: number; height: number }
    | {
        type: "detected";
        requestId: string;
        detection: SerializableDetection | null;
        needsSeed: boolean;
        reason: "ok" | "locator-miss" | "segment-failed" | "seed-invalid";
    }
    | { type: "error"; message: string; requestId?: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let currentFrame: FramePixels | null = null;

function serializeDetection(detection: Detection): SerializableDetection {
    const maskData = detection.mask.data.slice();
    return {
        bbox: detection.bbox,
        confidence: detection.confidence,
        source: detection.source,
        mask: {
            width: detection.mask.width,
            height: detection.mask.height,
            data: maskData.buffer,
        },
    };
}

function bitmapToFrame(bitmap: ImageBitmap): FramePixels {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
        bitmap.close();
        throw new Error("Unable to read frame pixels");
    }
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return {
        data: imageData.data,
        width: imageData.width,
        height: imageData.height,
    };
}

ctx.postMessage({ type: "ready" } satisfies DetectOutMsg);

ctx.addEventListener("message", async (e: MessageEvent<DetectInMsg>) => {
    const msg = e.data;
    try {
        if (msg.type === "ping") {
            ctx.postMessage({ type: "pong" } satisfies DetectOutMsg);
            return;
        }
        if (msg.type === "init-session") {
            const { createSession } = await import("@/lib/detect/session");
            const { provider } = await createSession(msg.modelUrl);
            ctx.postMessage({ type: "session-ready", provider } satisfies DetectOutMsg);
            return;
        }
        if (msg.type === "set-frame") {
            currentFrame = bitmapToFrame(msg.bitmap);
            ctx.postMessage({
                type: "frame-set",
                requestId: msg.requestId,
                width: currentFrame.width,
                height: currentFrame.height,
            } satisfies DetectOutMsg);
            return;
        }
        if (msg.type === "detect-frame") {
            if (!currentFrame) {
                ctx.postMessage({
                    type: "error",
                    requestId: msg.requestId,
                    message: "No frame loaded",
                } satisfies DetectOutMsg);
                return;
            }

            const result = await detectFrame(currentFrame, msg.seed);
            const serialized = result.detection ? serializeDetection(result.detection) : null;
            const transfer: Transferable[] = serialized ? [serialized.mask.data] : [];
            ctx.postMessage(
                {
                    type: "detected",
                    requestId: msg.requestId,
                    detection: serialized,
                    needsSeed: result.needsSeed,
                    reason: result.reason,
                } satisfies DetectOutMsg,
                transfer,
            );
            return;
        }
    } catch (err) {
        ctx.postMessage({
            type: "error",
            requestId: "requestId" in msg ? msg.requestId : undefined,
            message: err instanceof Error ? err.message : String(err),
        } satisfies DetectOutMsg);
    }
});
