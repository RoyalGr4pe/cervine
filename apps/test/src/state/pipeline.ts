import { create } from "zustand";
import type { Mesh, FrameState } from "@/lib/mesh";
import type { BBox, SeedPoint } from "@/lib/detect";

export type Density = "low" | "medium" | "high";

export type Settings = {
    lineColor: string;
    useSourceColor: boolean;
    lineWidth: number;
    backgroundColor: string;
    density: Density;
};

export type PipelineStatus = "idle" | "uploading" | "processing" | "ready" | "error";

export type DetectionPreview = {
    width: number;
    height: number;
    data: Float32Array;
    confidence: number;
    source: "locator" | "seed";
};

export type PipelineState = {
    status: PipelineStatus;
    totalFrames: number;
    processedFrames: number;
    videoFile: File | null;
    batchRunning: boolean;
    batchElapsedMs: number | null;
    keyframes: Map<number, Mesh>;
    frames: Map<number, FrameState>;
    frameBitmap: ImageBitmap | null;
    frameSize: { width: number; height: number } | null;
    detection: DetectionPreview | null;
    detectionBBox: BBox | null;
    detectionReason: "ok" | "locator-miss" | "segment-failed" | "seed-invalid" | null;
    settings: Settings;
    seedPoint: SeedPoint | null;
    needsSeed: boolean;
    playback: { currentFrame: number; playing: boolean };
    error: string | null;

    setStatus: (status: PipelineStatus) => void;
    setError: (error: string | null) => void;
    setSettings: (patch: Partial<Settings>) => void;
    setVideoFile: (file: File | null) => void;
    setProgress: (totalFrames: number, processedFrames: number) => void;
    setBatchState: (patch: Partial<Pick<PipelineState, "batchRunning" | "batchElapsedMs">>) => void;
    setFrameResult: (frameIndex: number, mesh: Mesh | null, frame: FrameState | null) => void;
    setFrameState: (frameIndex: number, frame: FrameState | null) => void;
    setFrame: (bitmap: ImageBitmap | null, size: { width: number; height: number } | null) => void;
    setFrameMesh: (mesh: Mesh | null, frame: FrameState | null) => void;
    setDetection: (
        detection: DetectionPreview | null,
        bbox: BBox | null,
        reason: PipelineState["detectionReason"],
    ) => void;
    setSeed: (seed: SeedPoint | null) => void;
    setNeedsSeed: (needs: boolean) => void;
    setPlayback: (patch: Partial<PipelineState["playback"]>) => void;
    reset: () => void;
};

const DEFAULT_SETTINGS: Settings = {
    lineColor: "#ffffff",
    useSourceColor: false,
    lineWidth: 1,
    backgroundColor: "#000000",
    density: "medium",
};

export const usePipeline = create<PipelineState>((set) => ({
    status: "idle",
    totalFrames: 0,
    processedFrames: 0,
    videoFile: null,
    batchRunning: false,
    batchElapsedMs: null,
    keyframes: new Map(),
    frames: new Map(),
    frameBitmap: null,
    frameSize: null,
    detection: null,
    detectionBBox: null,
    detectionReason: null,
    settings: DEFAULT_SETTINGS,
    seedPoint: null,
    needsSeed: false,
    playback: { currentFrame: 0, playing: false },
    error: null,

    setStatus: (status) => set({ status }),
    setError: (error) => set({ error, status: error ? "error" : "idle" }),
    setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    setVideoFile: (videoFile) => set({ videoFile }),
    setProgress: (totalFrames, processedFrames) => set({ totalFrames, processedFrames }),
    setBatchState: (patch) => set(patch),
    setFrameResult: (frameIndex, mesh, frame) =>
        set((s) => {
            const keyframes = new Map(s.keyframes);
            const frames = new Map(s.frames);
            if (mesh && frame) {
                keyframes.set(frameIndex, mesh);
                frames.set(frameIndex, frame);
            } else {
                keyframes.delete(frameIndex);
                frames.delete(frameIndex);
            }
            return { keyframes, frames };
        }),
    setFrameState: (frameIndex, frame) =>
        set((s) => {
            const frames = new Map(s.frames);
            if (frame) {
                frames.set(frameIndex, frame);
            } else {
                frames.delete(frameIndex);
            }
            return { frames };
        }),
    setFrame: (frameBitmap, frameSize) => set({ frameBitmap, frameSize }),
    setFrameMesh: (mesh, frame) =>
        set((s) => {
            const keyframes = new Map(s.keyframes);
            const frames = new Map(s.frames);
            if (mesh && frame) {
                keyframes.set(0, mesh);
                frames.set(0, frame);
            } else {
                keyframes.delete(0);
                frames.delete(0);
            }
            return { keyframes, frames };
        }),
    setDetection: (detection, detectionBBox, detectionReason) =>
        set({ detection, detectionBBox, detectionReason }),
    setSeed: (seedPoint) => set({ seedPoint }),
    setNeedsSeed: (needsSeed) => set({ needsSeed }),
    setPlayback: (patch) => set((s) => ({ playback: { ...s.playback, ...patch } })),
    reset: () =>
        set({
            status: "idle",
            totalFrames: 0,
            processedFrames: 0,
            videoFile: null,
            batchRunning: false,
            batchElapsedMs: null,
            keyframes: new Map(),
            frames: new Map(),
            frameBitmap: null,
            frameSize: null,
            detection: null,
            detectionBBox: null,
            detectionReason: null,
            seedPoint: null,
            needsSeed: false,
            playback: { currentFrame: 0, playing: false },
            error: null,
        }),
}));
