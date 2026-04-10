"use client";

import { useRef, useEffect } from "react";
import type { Dot } from "@repo/video-core";
import styles from "./ProcessingView.module.css";

interface Props {
  processed: number;
  total: number;
  latestDots: Dot[];
  dotSize: number;
  videoWidth: number;
  videoHeight: number;
  onCancel: () => void;
}

export function ProcessingView({
  processed,
  total,
  latestDots,
  dotSize,
  videoWidth,
  videoHeight,
  onCancel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  // Draw latest dots whenever they change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || videoWidth === 0 || videoHeight === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, videoWidth, videoHeight);
    for (const dot of latestDots) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dotSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${dot.r},${dot.g},${dot.b})`;
      ctx.fill();
    }
  }, [latestDots, dotSize, videoWidth, videoHeight]);

  return (
    <div className={styles.container}>
      {videoWidth > 0 && (
        <canvas
          ref={canvasRef}
          width={videoWidth}
          height={videoHeight}
          className={styles.preview}
        />
      )}
      <div className={styles.footer}>
        <div className={styles.progressBlock}>
          <p className={styles.label}>
            Processing… {processed} / {total} ({pct}%)
          </p>
          <div className={styles.track}>
            <div className={styles.bar} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button onClick={onCancel} className={styles.cancelBtn}>Cancel</button>
      </div>
    </div>
  );
}
