"use client";

import { useEffect, useRef, useCallback, type RefObject } from "react";
import { extractFrame, detectObject } from "@repo/video-core";
import styles from "./ObjectOutline.module.css";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  threshold?: number;
  spacing?: number;
  /** Dot radius in pixels. When undefined, auto = spacing * 0.4 */
  dotSize?: number;
  /** Fixed hex colour e.g. "#ffffff". When undefined, sample from source image. */
  dotColor?: string | null;
}

export function ObjectOutline({
  videoRef,
  threshold = 60,
  spacing = 12,
  dotSize,
  dotColor = null,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const run = useCallback(() => {
    const vid    = videoRef.current;
    const canvas = canvasRef.current;
    if (!vid || !canvas) return;
    if (vid.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const vw = vid.videoWidth;
    const vh = vid.videoHeight;
    canvas.width  = vw;
    canvas.height = vh;

    const frame = extractFrame(vid);
    if (!frame) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const result = detectObject(frame, threshold, 80);
    ctx.clearRect(0, 0, vw, vh);

    if (!result) {
      ctx.fillStyle = "rgba(255,80,80,0.7)";
      ctx.font = `${Math.round(vh * 0.04)}px monospace`;
      ctx.fillText("No object detected — try adjusting threshold", 20, vh * 0.5);
      return;
    }

    const { mask } = result;
    const src = frame.data;
    const radius = dotSize !== undefined ? dotSize : Math.max(1, spacing * 0.4);
    const fixedColor = dotColor ?? null;

    for (let y = 0; y < vh; y += spacing) {
      for (let x = 0; x < vw; x += spacing) {
        if (!mask[y * vw + x]) continue;

        if (fixedColor) {
          ctx.fillStyle = fixedColor;
        } else {
          const p = (y * vw + x) * 4;
          ctx.fillStyle = `rgb(${src[p] ?? 0},${src[p + 1] ?? 0},${src[p + 2] ?? 0})`;
        }

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [videoRef, threshold, spacing, dotSize, dotColor]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const handler = () => run();
    vid.addEventListener("seeked",         handler);
    vid.addEventListener("loadeddata",     handler);
    vid.addEventListener("loadedmetadata", handler);
    return () => {
      vid.removeEventListener("seeked",         handler);
      vid.removeEventListener("loadeddata",     handler);
      vid.removeEventListener("loadedmetadata", handler);
    };
  }, [videoRef, run]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      onClick={run}
      title="Click to re-detect"
    />
  );
}
