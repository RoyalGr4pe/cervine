import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectObjectFast, sampleBorderColor } from "../dist/detectObject.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "../../..");
const REPORT_PATH = resolve(ROOT, "tasks/baselines/detection-baseline.md");

const WIDTH = 320;
const HEIGHT = 180;
const FRAMES = 90;
const THRESHOLD = 60;
const SPACING = 12;

function clampByte(n) {
    return Math.max(0, Math.min(255, Math.round(n)));
}

function hashNoise(x, y, t) {
    let v = (x * 73856093) ^ (y * 19349663) ^ (t * 83492791);
    v ^= v >>> 13;
    v ^= v << 17;
    v ^= v >>> 5;
    return Math.abs(v % 256);
}

function paintCircle(data, width, height, cx, cy, radius, color) {
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(height - 1, Math.ceil(cy + radius));

    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const dx = x - cx;
            const dy = y - cy;
            if ((dx * dx + dy * dy) > r2) continue;
            const p = (y * width + x) * 4;
            data[p] = color.r;
            data[p + 1] = color.g;
            data[p + 2] = color.b;
            data[p + 3] = 255;
        }
    }
}

function makeFrame({ width, height, t, scene }) {
    const data = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const p = (y * width + x) * 4;
            let r = 0;
            let g = 0;
            let b = 0;

            if (scene === "simple") {
                r = 32;
                g = 36;
                b = 42;
            } else if (scene === "colorful") {
                const n = hashNoise(x, y, t);
                r = clampByte(90 + (x / width) * 80 + n * 0.35);
                g = clampByte(70 + (y / height) * 100 + n * 0.25);
                b = clampByte(110 + ((x + y) / (width + height)) * 70 + n * 0.2);
            } else {
                // fast-motion
                const n = hashNoise(x, y, t);
                r = clampByte(45 + n * 0.2);
                g = clampByte(45 + n * 0.15);
                b = clampByte(55 + n * 0.2);
            }

            data[p] = r;
            data[p + 1] = g;
            data[p + 2] = b;
            data[p + 3] = 255;
        }
    }

    if (scene === "simple") {
        const cx = 70 + t * 1.9;
        const cy = 90 + Math.sin(t * 0.12) * 16;
        paintCircle(data, width, height, cx, cy, 28, { r: 235, g: 160, b: 48 });
    } else if (scene === "colorful") {
        const cx = 80 + t * 1.4;
        const cy = 90 + Math.sin(t * 0.2) * 25;
        paintCircle(data, width, height, cx, cy, 24, { r: 245, g: 210, b: 70 });
        paintCircle(data, width, height, cx + 12, cy - 8, 9, { r: 255, g: 245, b: 150 });
    } else {
        const cx = 30 + ((t * 7) % (width + 60)) - 30;
        const cy = 90 + Math.sin(t * 0.32) * 30;
        paintCircle(data, width, height, cx, cy, 20, { r: 220, g: 100, b: 90 });
    }

    return {
        width,
        height,
        data,
        colorSpace: "srgb",
    };
}

function countDots(mask, width, height, centroid, spacing) {
    if (!centroid) return 0;
    const originX = ((centroid.x % spacing) + spacing) % spacing;
    const originY = ((centroid.y % spacing) + spacing) % spacing;

    let dots = 0;
    for (let y = originY; y < height; y += spacing) {
        for (let x = originX; x < width; x += spacing) {
            const ix = Math.round(x);
            const iy = Math.round(y);
            if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue;
            if (mask[iy * width + ix]) dots++;
        }
    }
    return dots;
}

function mean(nums) {
    if (!nums.length) return 0;
    return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}

function stdDev(nums) {
    if (!nums.length) return 0;
    const m = mean(nums);
    return Math.sqrt(mean(nums.map((n) => (n - m) ** 2)));
}

function evaluateClip({ name, category, scene }) {
    const timings = [];
    const dotCounts = [];
    let detectedFrames = 0;

    for (let i = 0; i < FRAMES; i++) {
        const frame = makeFrame({ width: WIDTH, height: HEIGHT, t: i, scene });
        const start = performance.now();
        const bg = sampleBorderColor(frame);
        const result = detectObjectFast(frame, bg, THRESHOLD);
        timings.push(performance.now() - start);

        if (!result) {
            dotCounts.push(0);
            continue;
        }

        detectedFrames++;
        dotCounts.push(countDots(result.mask, WIDTH, HEIGHT, result.centroid, SPACING));
    }

    const deltas = [];
    for (let i = 1; i < dotCounts.length; i++) {
        deltas.push(Math.abs(dotCounts[i] - dotCounts[i - 1]));
    }

    const avgDots = mean(dotCounts);
    const avgDelta = mean(deltas);
    const cv = avgDots > 0 ? stdDev(dotCounts) / avgDots : 0;
    const stabilityScore = avgDots > 0 ? Math.max(0, 1 - avgDelta / avgDots) * 100 : 0;

    return {
        name,
        category,
        frames: FRAMES,
        successRate: (detectedFrames / FRAMES) * 100,
        avgMsPerFrame: mean(timings),
        avgDots,
        cv,
        stabilityScore,
    };
}

function fmt(n, digits = 2) {
    return Number(n).toFixed(digits);
}

async function main() {
    const clips = [
        { name: "Simple-01", category: "simple background", scene: "simple" },
        { name: "Colorful-01", category: "colorful background", scene: "colorful" },
        { name: "Motion-01", category: "fast motion", scene: "fast-motion" },
    ];

    const rows = clips.map(evaluateClip);

    const markdown = [
        "# Detection Baseline Report",
        "",
        `Generated: ${new Date().toISOString()}`,
        "",
        "## Benchmark Setup",
        "",
        `- Frame size: ${WIDTH}x${HEIGHT}`,
        `- Frames per clip: ${FRAMES}`,
        `- Threshold: ${THRESHOLD}`,
        `- Dot spacing (for stability metric): ${SPACING}`,
        "- Detector path: detectObjectFast + border color sampling",
        "",
        "## Results",
        "",
        "| Clip | Category | Frames | Detection success | Avg ms/frame | Avg dots | Dot CV | Stability score |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ...rows.map((r) =>
            `| ${r.name} | ${r.category} | ${r.frames} | ${fmt(r.successRate)}% | ${fmt(r.avgMsPerFrame)} | ${fmt(r.avgDots)} | ${fmt(r.cv)} | ${fmt(r.stabilityScore)} |`
        ),
        "",
        "## Notes",
        "",
        "- Detection success: percent of frames returning a foreground mask.",
        "- Dot CV: coefficient of variation ($std/mean$) for per-frame dot counts.",
        "- Stability score: $100 * max(0, 1 - mean(abs(delta dots))/mean(dots))$.",
        "- This synthetic benchmark gives a repeatable baseline for algorithm comparisons before real-clip tuning.",
        "",
        "## Re-run",
        "",
        "```bash",
        "pnpm --filter @repo/video-core benchmark:detection",
        "```",
        "",
    ].join("\n");

    await mkdir(dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, markdown, "utf8");

    console.log(`Detection baseline written to ${REPORT_PATH}`);
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
