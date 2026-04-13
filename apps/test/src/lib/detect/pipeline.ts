import { cleanup } from "./cleanup";
import { locate } from "./locator";
import { seedToCrop, tightenCropFromMask, validateSeedMask } from "./seed";
import { segment } from "./segmenter";
import type { BBox, DetectFrameResult, Detection, FramePixels, SeedPoint } from "./types";
import { maskBoundingBox, normalizeBBox, pasteMaskIntoFrame } from "./utils";

function insideMargin(local: BBox, containerW: number, containerH: number, margin = 0.1): boolean {
    const left = local.x / containerW;
    const top = local.y / containerH;
    const right = (containerW - (local.x + local.w)) / containerW;
    const bottom = (containerH - (local.y + local.h)) / containerH;
    return left >= margin && top >= margin && right >= margin && bottom >= margin;
}

async function runCrop(frame: FramePixels, crop: BBox): Promise<Detection | null> {
    const softMask = await segment(frame, crop);
    if (!softMask) return null;

    const cleaned = cleanup(softMask);
    const fullMask = pasteMaskIntoFrame(cleaned, crop, frame.width, frame.height);
    const bounds = maskBoundingBox(fullMask, 0.35) ?? normalizeBBox(crop, frame.width, frame.height);

    return {
        bbox: bounds,
        mask: fullMask,
        confidence: 0.6,
        source: "locator",
    };
}

async function runSeeded(frame: FramePixels, seed: SeedPoint): Promise<Detection | null> {
    let crop = seedToCrop(seed, frame.width, frame.height, 0.4);
    let mask = await segment(frame, crop);

    if (!mask) {
        crop = seedToCrop(seed, frame.width, frame.height, 0.7);
        mask = await segment(frame, crop);
    }

    if (!mask) return null;

    let cleaned = cleanup(mask);
    if (!validateSeedMask(seed, crop, cleaned)) {
        const expanded = seedToCrop(seed, frame.width, frame.height, 0.7);
        mask = await segment(frame, expanded);
        if (!mask) return null;
        crop = expanded;
        cleaned = cleanup(mask);
        if (!validateSeedMask(seed, crop, cleaned)) return null;
    }

    const localBounds = maskBoundingBox(cleaned, 0.35);
    if (localBounds && insideMargin(localBounds, cleaned.width, cleaned.height, 0.1)) {
        const tight = tightenCropFromMask(cleaned, crop, frame.width, frame.height, 0.15);
        if (tight) {
            const refined = await segment(frame, tight);
            if (refined) {
                crop = tight;
                cleaned = cleanup(refined);
            }
        }
    }

    const fullMask = pasteMaskIntoFrame(cleaned, crop, frame.width, frame.height);
    const bbox = maskBoundingBox(fullMask, 0.35) ?? crop;
    return {
        bbox,
        mask: fullMask,
        confidence: 0.75,
        source: "seed",
    };
}

export async function detectFrame(
    frame: FramePixels,
    seed: SeedPoint | null,
): Promise<DetectFrameResult> {
    if (seed) {
        const seeded = await runSeeded(frame, seed);
        if (!seeded) {
            return {
                detection: null,
                needsSeed: true,
                reason: "seed-invalid",
            };
        }
        return {
            detection: seeded,
            needsSeed: false,
            reason: "ok",
        };
    }

    const located = await locate(frame);
    if (!located) {
        return {
            detection: null,
            needsSeed: true,
            reason: "locator-miss",
        };
    }

    const locatedDetection = await runCrop(frame, located.bbox);
    if (!locatedDetection) {
        return {
            detection: null,
            needsSeed: true,
            reason: "segment-failed",
        };
    }

    return {
        detection: {
            ...locatedDetection,
            confidence: located.confidence,
            source: "locator",
        },
        needsSeed: false,
        reason: "ok",
    };
}
