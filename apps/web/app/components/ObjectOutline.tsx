"use client";

import { useEffect, useRef, useCallback, type RefObject } from "react";
import {
  extractFrame,
  detectObject,
  keepLargestBlob,
  trackDotFrames,
} from "@repo/video-core";
import type { Dot, TrackedDot } from "@repo/video-core";
import styles from "./ObjectOutline.module.css";
import { renderFrame } from "./renderModes";
import type { MeshColorMode, RenderMode } from "./renderModes";
import type { MlMaskProvider } from "./mlMaskProvider";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  threshold?: number;
  spacing?: number;
  dotSize?: number;
  dotColor?: string | null;
  renderMode: RenderMode;
  meshLineWidth: number;
  meshColorMode: MeshColorMode;
  detectorMode: "classic" | "ml";
  mlMaskProvider?: MlMaskProvider;
}

type DrawableDot = Dot & { opacity?: number };

function interpolateTrackedDots(
  current: TrackedDot[],
  next: TrackedDot[],
  t: number,
): DrawableDot[] {
  const nextById = new Map(next.map((d) => [d.id, d]));
  const currentIds = new Set<number>();
  const interpolated: DrawableDot[] = [];

  for (const dot of current) {
    currentIds.add(dot.id);
    const n = nextById.get(dot.id);

    if (n) {
      interpolated.push({
        x: dot.x + (n.x - dot.x) * t,
        y: dot.y + (n.y - dot.y) * t,
        r: Math.round(dot.r + (n.r - dot.r) * t),
        g: Math.round(dot.g + (n.g - dot.g) * t),
        b: Math.round(dot.b + (n.b - dot.b) * t),
        opacity: dot.opacity + (n.opacity - dot.opacity) * t,
      });
      continue;
    }

    interpolated.push({
      x: dot.x + dot.vx * t,
      y: dot.y + dot.vy * t,
      r: dot.r,
      g: dot.g,
      b: dot.b,
      opacity: dot.opacity * (1 - t),
    });
  }

  for (const dot of next) {
    if (currentIds.has(dot.id)) continue;
    interpolated.push({
      x: dot.x - dot.vx * (1 - t),
      y: dot.y - dot.vy * (1 - t),
      r: dot.r,
      g: dot.g,
      b: dot.b,
      opacity: dot.opacity * t,
    });
  }

  return interpolated;
}

export function ObjectOutline({
  videoRef,
  threshold = 60,
  spacing = 12,
  dotSize,
  dotColor = null,
  renderMode,
  meshLineWidth,
  meshColorMode,
  detectorMode,
  mlMaskProvider,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const mlIntervalRef = useRef<number | null>(null);
  const runTokenRef = useRef(0);
  const tweenRafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const rerunRequestedRef = useRef(false);
  const previousDotsRef = useRef<Dot[] | null>(null);
  const transitionRef = useRef<{
    from: TrackedDot[];
    to: TrackedDot[];
    start: number;
    durationMs: number;
  } | null>(null);

  const ML_LOOP_INTERVAL_MS = 720;
  const ML_TWEEN_DURATION_MS = 280;

  const drawDots = useCallback(
    (dots: DrawableDot[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const radius =
        dotSize !== undefined ? dotSize : Math.max(1, spacing * 0.4);

      renderFrame(ctx, dots, {
        mode: renderMode,
        dotSize: radius,
        meshLineWidth,
        meshColorMode,
        meshSingleColor: dotColor,
      });
    },
    [dotColor, dotSize, meshColorMode, meshLineWidth, renderMode, spacing],
  );

  const startTween = useCallback(() => {
    if (tweenRafRef.current !== null) return;

    const tick = () => {
      const transition = transitionRef.current;
      if (!transition) {
        tweenRafRef.current = null;
        return;
      }

      const elapsed = performance.now() - transition.start;
      const rawT = Math.max(0, Math.min(1, elapsed / transition.durationMs));
      const easedT = rawT * rawT * (3 - 2 * rawT);
      drawDots(interpolateTrackedDots(transition.from, transition.to, easedT));

      if (rawT >= 1) {
        transitionRef.current = null;
        tweenRafRef.current = null;
        return;
      }

      tweenRafRef.current = requestAnimationFrame(tick);
    };

    tweenRafRef.current = requestAnimationFrame(tick);
  }, [drawDots]);

  const run = useCallback(() => {
    if (runningRef.current) {
      if (detectorMode === "classic") {
        rerunRequestedRef.current = true;
      }
      return;
    }

    runningRef.current = true;
    const token = ++runTokenRef.current;

    const runAsync = async () => {
      const vid = videoRef.current;
      const canvas = canvasRef.current;
      if (!vid || !canvas) return;
      if (vid.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      const vw = vid.videoWidth;
      const vh = vid.videoHeight;
      canvas.width = vw;
      canvas.height = vh;

      const frame = extractFrame(vid);
      if (!frame) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      let mask: Uint8Array | null = null;

      if (detectorMode === "ml" && mlMaskProvider) {
        const mlMask = await mlMaskProvider(frame, { fastPreview: true });
        if (token !== runTokenRef.current) return;
        if (mlMask && mlMask.length === vw * vh) {
          mask = keepLargestBlob(mlMask, vw, vh);
        } else {
          previousDotsRef.current = null;
          transitionRef.current = null;
          ctx.clearRect(0, 0, vw, vh);
          ctx.fillStyle = "rgba(255,255,255,0.72)";
          ctx.font = `${Math.round(vh * 0.04)}px monospace`;
          ctx.fillText("Loading ML model...", 20, vh * 0.5);
          return;
        }
      }

      if (!mask) {
        if (detectorMode === "ml") {
          previousDotsRef.current = null;
          transitionRef.current = null;
          ctx.clearRect(0, 0, vw, vh);
          return;
        }
        const result = detectObject(frame, threshold, 80);
        if (!result) {
          previousDotsRef.current = null;
          transitionRef.current = null;
          ctx.clearRect(0, 0, vw, vh);
          ctx.fillStyle = "rgba(255,80,80,0.7)";
          ctx.font = `${Math.round(vh * 0.04)}px monospace`;
          ctx.fillText(
            "No object detected — try adjusting threshold",
            20,
            vh * 0.5,
          );
          return;
        }
        mask = result.mask;
      }

      const src = frame.data;
      const fixedColor = dotColor ?? null;
      const dots: Dot[] = [];
      const useTriangularSampling = renderMode === "delaunay";

      for (let y = 0, row = 0; y < vh; y += spacing, row++) {
        const rowOffset =
          useTriangularSampling && row % 2 === 1 ? spacing * 0.5 : 0;

        for (let x = rowOffset - spacing; x < vw; x += spacing) {
          const ix = Math.round(x);
          const iy = Math.round(y);
          if (ix < 0 || ix >= vw || iy < 0 || iy >= vh) continue;
          if (!mask[iy * vw + ix]) continue;

          if (fixedColor) {
            const hex = fixedColor.replace("#", "");
            const int = Number.parseInt(hex, 16);
            dots.push({
              x: ix,
              y: iy,
              r: (int >> 16) & 255,
              g: (int >> 8) & 255,
              b: int & 255,
            });
          } else {
            const p = (iy * vw + ix) * 4;
            dots.push({
              x: ix,
              y: iy,
              r: src[p] ?? 0,
              g: src[p + 1] ?? 0,
              b: src[p + 2] ?? 0,
            });
          }
        }
      }

      if (
        detectorMode === "ml" &&
        previousDotsRef.current &&
        previousDotsRef.current.length > 0 &&
        dots.length > 0
      ) {
        const tracked = trackDotFrames([previousDotsRef.current, dots], {
          maxMatchDistance: Math.max(10, spacing * 2.25),
          despawnTTL: 2,
        });
        transitionRef.current = {
          from: tracked[0] ?? [],
          to: tracked[1] ?? [],
          start: performance.now(),
          durationMs: ML_TWEEN_DURATION_MS,
        };
        startTween();
      } else {
        transitionRef.current = null;
        if (tweenRafRef.current !== null) {
          cancelAnimationFrame(tweenRafRef.current);
          tweenRafRef.current = null;
        }
        drawDots(dots);
      }

      previousDotsRef.current = dots;
    };

    runAsync()
      .catch((err) => {
        console.error("Preview detection failed", err);
      })
      .finally(() => {
        runningRef.current = false;
        if (detectorMode === "classic" && rerunRequestedRef.current) {
          rerunRequestedRef.current = false;
          window.requestAnimationFrame(() => run());
        }
      });
  }, [
    detectorMode,
    dotColor,
    dotSize,
    meshColorMode,
    meshLineWidth,
    mlMaskProvider,
    renderMode,
    spacing,
    threshold,
    videoRef,
  ]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const handler = () => run();
    vid.addEventListener("seeked", handler);
    vid.addEventListener("loadeddata", handler);
    vid.addEventListener("loadedmetadata", handler);
    if (detectorMode === "classic") {
      vid.addEventListener("timeupdate", handler);
    }

    const startLoop = () => {
      if (detectorMode === "ml") {
        if (mlIntervalRef.current === null) {
          mlIntervalRef.current = window.setInterval(() => {
            run();
          }, ML_LOOP_INTERVAL_MS);
        }
        return;
      }

      const tick = () => {
        run();
        if (!vid.paused && !vid.ended) {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    const stopLoop = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (mlIntervalRef.current !== null) {
        window.clearInterval(mlIntervalRef.current);
        mlIntervalRef.current = null;
      }
      if (tweenRafRef.current !== null) {
        cancelAnimationFrame(tweenRafRef.current);
        tweenRafRef.current = null;
      }
      transitionRef.current = null;
      previousDotsRef.current = null;
      rerunRequestedRef.current = false;
    };

    vid.addEventListener("play", startLoop);
    vid.addEventListener("pause", stopLoop);
    vid.addEventListener("ended", stopLoop);
    run();

    return () => {
      stopLoop();
      runTokenRef.current++;
      runningRef.current = false;
      rerunRequestedRef.current = false;
      vid.removeEventListener("seeked", handler);
      vid.removeEventListener("loadeddata", handler);
      vid.removeEventListener("loadedmetadata", handler);
      if (detectorMode === "classic") {
        vid.removeEventListener("timeupdate", handler);
      }
      vid.removeEventListener("play", startLoop);
      vid.removeEventListener("pause", stopLoop);
      vid.removeEventListener("ended", stopLoop);
    };
  }, [videoRef, run, detectorMode]);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      onClick={run}
      title="Click to re-detect"
    />
  );
}
