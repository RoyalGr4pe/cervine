import type { BBox, FramePixels } from "./types";
import { bboxArea, clamp, expandBBox } from "./utils";

export type LocatorResult = {
    bbox: BBox;
    confidence: number;
};

function estimateBackgroundColor(frame: FramePixels): { r: number; g: number; b: number } {
    const border = Math.max(2, Math.floor(Math.min(frame.width, frame.height) * 0.06));
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;

    for (let y = 0; y < frame.height; y += 1) {
        for (let x = 0; x < frame.width; x += 1) {
            const isBorder = x < border || y < border || x >= frame.width - border || y >= frame.height - border;
            if (!isBorder) continue;
            const i = (y * frame.width + x) * 4;
            r += frame.data[i];
            g += frame.data[i + 1];
            b += frame.data[i + 2];
            count += 1;
        }
    }

    if (count === 0) return { r: 0, g: 0, b: 0 };
    return {
        r: r / count,
        g: g / count,
        b: b / count,
    };
}

export async function locate(frame: FramePixels): Promise<LocatorResult | null> {
    // This heuristic locator is the Phase 1 bridge until YOLOv8n ONNX weights are plugged in.
    // It finds the most foreground-like region by contrasting against border color.
    const bg = estimateBackgroundColor(frame);
    const scores = new Float32Array(frame.width * frame.height);
    let sum = 0;
    let sumSq = 0;

    for (let y = 0; y < frame.height; y += 1) {
        for (let x = 0; x < frame.width; x += 1) {
            const i = (y * frame.width + x) * 4;
            const dr = frame.data[i] - bg.r;
            const dg = frame.data[i + 1] - bg.g;
            const db = frame.data[i + 2] - bg.b;
            const score = Math.sqrt(dr * dr + dg * dg + db * db);
            const idx = y * frame.width + x;
            scores[idx] = score;
            sum += score;
            sumSq += score * score;
        }
    }

    const total = scores.length;
    const mean = sum / total;
    const variance = Math.max(0, sumSq / total - mean * mean);
    const std = Math.sqrt(variance);
    const threshold = mean + std * 0.8;

    let minX = frame.width;
    let minY = frame.height;
    let maxX = -1;
    let maxY = -1;
    let area = 0;
    let selectedScoreSum = 0;

    for (let y = 0; y < frame.height; y += 1) {
        for (let x = 0; x < frame.width; x += 1) {
            const idx = y * frame.width + x;
            const alpha = frame.data[idx * 4 + 3];
            if (alpha <= 0 || scores[idx] < threshold) continue;
            area += 1;
            selectedScoreSum += scores[idx];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    if (area === 0 || maxX < minX || maxY < minY) return null;

    const rawBox: BBox = {
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
    };
    const expanded = expandBBox(rawBox, frame.width, frame.height, 0.15);
    const frameArea = frame.width * frame.height;
    const boxAreaRatio = bboxArea(expanded) / frameArea;

    // Guard rails from the task doc: reject tiny or implausibly huge detections.
    if (boxAreaRatio < 0.02 || boxAreaRatio > 0.95) return null;

    const selectedMean = selectedScoreSum / area;
    const confidence = clamp((selectedMean - mean) / Math.max(std * 2, 1), 0, 1);

    return {
        bbox: expanded,
        confidence,
    };
}
