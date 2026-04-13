export type BBox = { x: number; y: number; w: number; h: number };

export type FramePixels = {
    data: Uint8ClampedArray;
    width: number;
    height: number;
};

export type Mask = {
    data: Float32Array;
    width: number;
    height: number;
};

export type Detection = {
    bbox: BBox;
    mask: Mask;
    confidence: number;
    source: "locator" | "seed";
};

export type SeedPoint = { x: number; y: number };

export type DetectFrameResult = {
    detection: Detection | null;
    needsSeed: boolean;
    reason: "ok" | "locator-miss" | "segment-failed" | "seed-invalid";
};

export type ExecutionProvider = "webgpu" | "wasm";
