import type { Dot } from "./processVideo";

export interface TrackedDot extends Dot {
    id: number;
    vx: number;
    vy: number;
    age: number;
    ttl: number;
    opacity: number;
    state: "tracked" | "spawned" | "fading";
}

export interface TrackOptions {
    maxMatchDistance?: number;
    despawnTTL?: number;
}

interface ActiveDot extends TrackedDot { }

function clamp01(n: number): number {
    return Math.max(0, Math.min(1, n));
}

function nearestMatchIndex(
    dot: Dot,
    prev: ActiveDot[],
    used: Uint8Array,
    maxDist2: number
): number {
    let bestIdx = -1;
    let bestDist2 = Number.POSITIVE_INFINITY;

    for (let i = 0; i < prev.length; i++) {
        if (used[i]) continue;
        const p = prev[i]!;
        const dx = dot.x - p.x;
        const dy = dot.y - p.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > maxDist2) continue;
        if (dist2 < bestDist2) {
            bestDist2 = dist2;
            bestIdx = i;
        }
    }

    return bestIdx;
}

/**
 * Tracks dot identity frame-to-frame with nearest-neighbor matching.
 * Unmatched dots fade out for a short TTL to avoid abrupt disappearances.
 */
export function trackDotFrames(frames: Dot[][], opts: TrackOptions = {}): TrackedDot[][] {
    const maxMatchDistance = opts.maxMatchDistance ?? 16;
    const despawnTTL = Math.max(1, opts.despawnTTL ?? 2);
    const maxDist2 = maxMatchDistance * maxMatchDistance;

    let nextId = 1;
    let prevActive: ActiveDot[] = [];
    const trackedFrames: TrackedDot[][] = [];

    for (const frameDots of frames) {
        const usedPrev = new Uint8Array(prevActive.length);
        const current: ActiveDot[] = [];

        for (const dot of frameDots) {
            const matchIdx = nearestMatchIndex(dot, prevActive, usedPrev, maxDist2);
            if (matchIdx >= 0) {
                usedPrev[matchIdx] = 1;
                const prev = prevActive[matchIdx]!;
                const vx = dot.x - prev.x;
                const vy = dot.y - prev.y;
                current.push({
                    ...dot,
                    id: prev.id,
                    vx,
                    vy,
                    age: prev.age + 1,
                    ttl: despawnTTL,
                    opacity: 1,
                    state: "tracked",
                });
            } else {
                current.push({
                    ...dot,
                    id: nextId++,
                    vx: 0,
                    vy: 0,
                    age: 1,
                    ttl: despawnTTL,
                    opacity: 1,
                    state: "spawned",
                });
            }
        }

        for (let i = 0; i < prevActive.length; i++) {
            if (usedPrev[i]) continue;
            const prev = prevActive[i]!;
            if (prev.ttl <= 1) continue;

            const ttl = prev.ttl - 1;
            const fadeProgress = 1 - ttl / despawnTTL;
            current.push({
                ...prev,
                x: prev.x + prev.vx,
                y: prev.y + prev.vy,
                ttl,
                opacity: clamp01(1 - fadeProgress),
                state: "fading",
            });
        }

        trackedFrames.push(current);
        prevActive = current;
    }

    return trackedFrames;
}
