import type { DetectInMsg, DetectOutMsg } from "@/workers/detect.worker";
import type { Detection, SeedPoint } from "./types";
import { getWorker } from "@/state/workers";

export type DetectClientResult = {
    detection: Detection | null;
    needsSeed: boolean;
    reason: "ok" | "locator-miss" | "segment-failed" | "seed-invalid";
};

function requestId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasRequestId(message: DetectOutMsg): message is DetectOutMsg & { requestId: string } {
    return typeof message === "object" && message !== null && "requestId" in message;
}

function postRequest<T extends DetectOutMsg>(
    worker: Worker,
    message: DetectInMsg,
    accept: (msg: DetectOutMsg) => msg is T,
    transfer: Transferable[] = [],
): Promise<T> {
    const messageRequestId = "requestId" in message ? message.requestId : null;

    return new Promise<T>((resolve, reject) => {
        const onMessage = (event: MessageEvent<DetectOutMsg>) => {
            const { data } = event;
            if (messageRequestId && hasRequestId(data) && data.requestId !== messageRequestId) {
                return;
            }
            if (data.type === "error") {
                worker.removeEventListener("message", onMessage);
                reject(new Error(data.message));
                return;
            }
            if (accept(data)) {
                worker.removeEventListener("message", onMessage);
                resolve(data);
            }
        };

        worker.addEventListener("message", onMessage);
        worker.postMessage(message, transfer);
    });
}

export async function setFrameForDetection(bitmap: ImageBitmap): Promise<{ width: number; height: number }> {
    const detect = getWorker("detect");
    await detect.ready;

    const msg: DetectInMsg = {
        type: "set-frame",
        requestId: requestId(),
        bitmap,
    };

    const out = await postRequest(
        detect.worker,
        msg,
        (event): event is Extract<DetectOutMsg, { type: "frame-set" }> => event.type === "frame-set",
        [bitmap],
    );

    return { width: out.width, height: out.height };
}

export async function detectCurrentFrame(seed: SeedPoint | null): Promise<DetectClientResult> {
    const detect = getWorker("detect");
    await detect.ready;

    const msg: DetectInMsg = {
        type: "detect-frame",
        requestId: requestId(),
        seed,
    };

    const out = await postRequest(
        detect.worker,
        msg,
        (event): event is Extract<DetectOutMsg, { type: "detected" }> => event.type === "detected",
    );

    const detection = out.detection
        ? {
            bbox: out.detection.bbox,
            confidence: out.detection.confidence,
            source: out.detection.source,
            mask: {
                width: out.detection.mask.width,
                height: out.detection.mask.height,
                data: new Float32Array(out.detection.mask.data),
            },
        }
        : null;

    return {
        detection,
        needsSeed: out.needsSeed,
        reason: out.reason,
    };
}
