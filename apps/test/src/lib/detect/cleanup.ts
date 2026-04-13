import type { Mask } from "./types";

function erode3x3(src: Uint8Array, width: number, height: number): Uint8Array {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            let keep = 1;
            for (let ky = -1; ky <= 1 && keep; ky += 1) {
                const yy = y + ky;
                if (yy < 0 || yy >= height) {
                    keep = 0;
                    break;
                }
                for (let kx = -1; kx <= 1; kx += 1) {
                    const xx = x + kx;
                    if (xx < 0 || xx >= width || src[yy * width + xx] === 0) {
                        keep = 0;
                        break;
                    }
                }
            }
            out[y * width + x] = keep;
        }
    }
    return out;
}

function dilate3x3(src: Uint8Array, width: number, height: number): Uint8Array {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            let on = 0;
            for (let ky = -1; ky <= 1 && !on; ky += 1) {
                const yy = y + ky;
                if (yy < 0 || yy >= height) continue;
                for (let kx = -1; kx <= 1; kx += 1) {
                    const xx = x + kx;
                    if (xx < 0 || xx >= width) continue;
                    if (src[yy * width + xx]) {
                        on = 1;
                        break;
                    }
                }
            }
            out[y * width + x] = on;
        }
    }
    return out;
}

function largestComponent(mask: Uint8Array, width: number, height: number): Uint8Array {
    const keep = new Uint8Array(mask.length);
    const visited = new Uint8Array(mask.length);
    const queue = new Int32Array(mask.length);
    let bestStart = -1;
    let bestSize = 0;

    for (let i = 0; i < mask.length; i += 1) {
        if (!mask[i] || visited[i]) continue;
        let head = 0;
        let tail = 0;
        queue[tail++] = i;
        visited[i] = 1;
        let size = 0;

        while (head < tail) {
            const current = queue[head++];
            size += 1;
            const x = current % width;
            const y = (current - x) / width;

            if (x > 0) {
                const n = current - 1;
                if (mask[n] && !visited[n]) {
                    visited[n] = 1;
                    queue[tail++] = n;
                }
            }
            if (x + 1 < width) {
                const n = current + 1;
                if (mask[n] && !visited[n]) {
                    visited[n] = 1;
                    queue[tail++] = n;
                }
            }
            if (y > 0) {
                const n = current - width;
                if (mask[n] && !visited[n]) {
                    visited[n] = 1;
                    queue[tail++] = n;
                }
            }
            if (y + 1 < height) {
                const n = current + width;
                if (mask[n] && !visited[n]) {
                    visited[n] = 1;
                    queue[tail++] = n;
                }
            }
        }

        if (size > bestSize) {
            bestSize = size;
            bestStart = i;
        }
    }

    if (bestStart < 0) return keep;

    visited.fill(0);
    let head = 0;
    let tail = 0;
    queue[tail++] = bestStart;
    visited[bestStart] = 1;

    while (head < tail) {
        const current = queue[head++];
        keep[current] = 1;
        const x = current % width;
        const y = (current - x) / width;

        if (x > 0) {
            const n = current - 1;
            if (mask[n] && !visited[n]) {
                visited[n] = 1;
                queue[tail++] = n;
            }
        }
        if (x + 1 < width) {
            const n = current + 1;
            if (mask[n] && !visited[n]) {
                visited[n] = 1;
                queue[tail++] = n;
            }
        }
        if (y > 0) {
            const n = current - width;
            if (mask[n] && !visited[n]) {
                visited[n] = 1;
                queue[tail++] = n;
            }
        }
        if (y + 1 < height) {
            const n = current + width;
            if (mask[n] && !visited[n]) {
                visited[n] = 1;
                queue[tail++] = n;
            }
        }
    }

    return keep;
}

export function cleanup(mask: Mask): Mask {
    const binary = new Uint8Array(mask.data.length);
    for (let i = 0; i < mask.data.length; i += 1) {
        binary[i] = mask.data[i] >= 0.5 ? 1 : 0;
    }

    // Open (erode + dilate) removes small speckle noise, then close fills tiny interior holes.
    const opened = dilate3x3(erode3x3(binary, mask.width, mask.height), mask.width, mask.height);
    const closed = erode3x3(dilate3x3(opened, mask.width, mask.height), mask.width, mask.height);
    const primary = largestComponent(closed, mask.width, mask.height);

    const out = new Float32Array(mask.data.length);
    for (let i = 0; i < mask.data.length; i += 1) {
        out[i] = primary[i] ? mask.data[i] : 0;
    }

    return {
        data: out,
        width: mask.width,
        height: mask.height,
    };
}
