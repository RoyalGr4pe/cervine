"use client";

import {
    removeBackground,
    preload,
    type Config as ImglyConfig,
} from "@imgly/background-removal";
import { env as ortEnv } from "onnxruntime-web";

export interface MlMaskOptions {
    fastPreview?: boolean;
}

export type MlMaskProvider = (
    frame: ImageData,
    options?: MlMaskOptions,
) => Promise<Uint8Array | null>;

const PREVIEW_MIN_INTERVAL_MS = 700;
const PREVIEW_MAX_SIDE = 192;
const PROCESS_MAX_SIDE = 320;
const PREVIEW_JPEG_QUALITY = 0.62;
const PROCESS_JPEG_QUALITY = 0.82;

const INFER_CONFIG: ImglyConfig = {
    model: "isnet_quint8",
    device: "cpu",
    proxyToWorker: true,
    debug: false,
};

function fitInto(width: number, height: number, maxSide: number): { w: number; h: number } {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return {
        w: Math.max(1, Math.round(width * scale)),
        h: Math.max(1, Math.round(height * scale)),
    };
}

function createReusableCanvas() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas context unavailable");
    return { canvas, ctx };
}

function drawMaskBlobToBinaryMask(
    blob: Blob,
    width: number,
    height: number,
    scratch: ReturnType<typeof createReusableCanvas>,
): Promise<Uint8Array> {
    return createImageBitmap(blob).then((bitmap) => {
        scratch.canvas.width = width;
        scratch.canvas.height = height;
        scratch.ctx.clearRect(0, 0, width, height);
        scratch.ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        const data = scratch.ctx.getImageData(0, 0, width, height).data;
        const mask = new Uint8Array(width * height);
        for (let i = 0; i < mask.length; i++) {
            const alpha = data[i * 4 + 3] ?? 0;
            mask[i] = alpha > 28 ? 1 : 0;
        }
        return mask;
    });
}

function frameToBlob(
    frame: ImageData,
    maxSide: number,
    quality: number,
    full: ReturnType<typeof createReusableCanvas>,
    scaled: ReturnType<typeof createReusableCanvas>,
): Promise<Blob> {
    full.canvas.width = frame.width;
    full.canvas.height = frame.height;
    full.ctx.putImageData(frame, 0, 0);

    const size = fitInto(frame.width, frame.height, maxSide);
    scaled.canvas.width = size.w;
    scaled.canvas.height = size.h;
    scaled.ctx.clearRect(0, 0, size.w, size.h);
    scaled.ctx.drawImage(full.canvas, 0, 0, size.w, size.h);

    return new Promise((resolve, reject) => {
        scaled.canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("Failed to serialize frame to blob"));
                return;
            }
            resolve(blob);
        }, "image/jpeg", quality);
    });
}

export function createMlMaskProvider(): MlMaskProvider {
    if (!crossOriginIsolated) {
        ortEnv.wasm.numThreads = 1;
    }

    const full = createReusableCanvas();
    const scaled = createReusableCanvas();
    const maskReadback = createReusableCanvas();

    let preloadPromise: Promise<void> | null = null;
    let preloadReady = false;
    let preloadScheduled = false;
    let inFlight: Promise<Uint8Array | null> | null = null;
    let lastMask: Uint8Array | null = null;
    let lastPreviewAt = 0;

    const ensurePreload = () => {
        if (!preloadPromise) {
            preloadPromise = preload(INFER_CONFIG)
                .then(() => {
                    preloadReady = true;
                })
                .catch((err) => {
                    console.error("ML preload failed", err);
                });
        }
        return preloadPromise;
    };

    const schedulePreload = () => {
        if (preloadScheduled || preloadReady) {
            return;
        }

        preloadScheduled = true;
        const start = () => {
            void ensurePreload();
        };

        const requestIdle = (window as Window & {
            requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
        }).requestIdleCallback;

        if (requestIdle) {
            requestIdle(start, { timeout: 2500 });
            return;
        }

        window.setTimeout(start, 300);
    };

    schedulePreload();

    const infer = async (frame: ImageData, fastPreview: boolean): Promise<Uint8Array | null> => {
        if (!preloadReady) {
            await ensurePreload();
            if (!preloadReady) {
                return null;
            }
        }
        const maxSide = fastPreview ? PREVIEW_MAX_SIDE : PROCESS_MAX_SIDE;
        const quality = fastPreview ? PREVIEW_JPEG_QUALITY : PROCESS_JPEG_QUALITY;
        const inputBlob = await frameToBlob(frame, maxSide, quality, full, scaled);
        const outputBlob = await removeBackground(inputBlob, INFER_CONFIG);
        return drawMaskBlobToBinaryMask(
            outputBlob,
            frame.width,
            frame.height,
            maskReadback,
        );
    };

    return async (frame: ImageData, options?: MlMaskOptions): Promise<Uint8Array | null> => {
        const fastPreview = options?.fastPreview ?? false;

        if (fastPreview) {
            schedulePreload();
            if (!preloadReady) {
                return lastMask;
            }
            const now = performance.now();
            if (inFlight || now - lastPreviewAt < PREVIEW_MIN_INTERVAL_MS) {
                return lastMask;
            }
            lastPreviewAt = now;
        }

        if (inFlight) {
            if (fastPreview) return lastMask;
            return inFlight;
        }

        if (!preloadReady && !fastPreview) {
            await ensurePreload();
            if (!preloadReady) {
                return null;
            }
        }

        inFlight = infer(frame, fastPreview)
            .then((mask) => {
                if (mask) lastMask = mask;
                return mask;
            })
            .catch((err) => {
                console.error("ML mask provider failed", err);
                return null;
            })
            .finally(() => {
                inFlight = null;
            });

        return inFlight;
    };
}
