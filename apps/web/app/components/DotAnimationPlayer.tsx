"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { DotAnimation } from "@repo/video-core";
import styles from "./DotAnimationPlayer.module.css";
import { analytics } from "../lib/analytics";
import { renderFrame } from "./renderModes";
import type { MeshColorMode, RenderMode } from "./renderModes";

interface Props {
  animation: DotAnimation;
  dotSize: number;
  renderMode: RenderMode;
  meshLineWidth: number;
  meshColorMode: MeshColorMode;
  meshSingleColor: string | null;
}

type EasingMode = "linear" | "smooth";

interface DrawableDot {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  opacity?: number;
}

export function DotAnimationPlayer({
  animation,
  dotSize,
  renderMode,
  meshLineWidth,
  meshColorMode,
  meshSingleColor,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [easingMode, setEasingMode] = useState<EasingMode>("smooth");

  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const {
    frames,
    trackedFrames,
    fps,
    frameCount,
    videoWidth: vw,
    videoHeight: vh,
  } = animation;

  const drawAtFramePosition = useCallback(
    (framePos: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, vw, vh);

      const base =
        ((Math.floor(framePos) % frameCount) + frameCount) % frameCount;
      const fracRaw = framePos - Math.floor(framePos);
      const frac = Math.max(0, Math.min(1, fracRaw));
      const t = easingMode === "smooth" ? frac * frac * (3 - 2 * frac) : frac;

      if (!trackedFrames || trackedFrames.length === 0) {
        const dots = frames[base] ?? [];
        renderFrame(ctx, dots, {
          mode: renderMode,
          dotSize,
          meshLineWidth,
          meshColorMode,
          meshSingleColor,
        });
        return;
      }

      const current = trackedFrames[base] ?? [];
      if (frac === 0 || trackedFrames.length === 1) {
        renderFrame(ctx, current, {
          mode: renderMode,
          dotSize,
          meshLineWidth,
          meshColorMode,
          meshSingleColor,
        });
        return;
      }

      const next = trackedFrames[(base + 1) % frameCount] ?? current;
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

      renderFrame(ctx, interpolated, {
        mode: renderMode,
        dotSize,
        meshLineWidth,
        meshColorMode,
        meshSingleColor,
      });
    },
    [
      dotSize,
      easingMode,
      frameCount,
      frames,
      meshColorMode,
      meshLineWidth,
      meshSingleColor,
      renderMode,
      trackedFrames,
      vh,
      vw,
    ],
  );

  useEffect(() => {
    if (!playing) drawAtFramePosition(currentFrame);
  }, [currentFrame, drawAtFramePosition, playing]);

  useEffect(() => {
    if (!playing) return;

    const loop = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = (now - startRef.current - offsetRef.current) / 1000;
      const framePos = (elapsed * fps) % frameCount;
      const idx = Math.floor(framePos);
      setCurrentFrame(idx);
      drawAtFramePosition(framePos);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [drawAtFramePosition, fps, frameCount, playing]);

  const togglePlay = () => {
    if (playing) {
      pausedAtRef.current = performance.now();
      setPlaying(false);
    } else {
      if (pausedAtRef.current !== null && startRef.current !== null) {
        offsetRef.current += performance.now() - pausedAtRef.current;
        pausedAtRef.current = null;
      }
      setPlaying(true);
    }
  };

  const restart = () => {
    startRef.current = null;
    offsetRef.current = 0;
    pausedAtRef.current = null;
    setCurrentFrame(0);
    setPlaying(true);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = Number(e.target.value);
    if (playing) {
      pausedAtRef.current = performance.now();
      setPlaying(false);
    }
    if (startRef.current !== null) {
      offsetRef.current =
        performance.now() - startRef.current - (idx / fps) * 1000;
    }
    setCurrentFrame(idx);
    drawAtFramePosition(idx);
  };

  const toggleEasingMode = () => {
    setEasingMode((m) => (m === "linear" ? "smooth" : "linear"));
  };

  const startExport = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || recording) return;

    const exportFps = Math.max(48, Math.round(fps * 2));

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    if (playing) {
      pausedAtRef.current = performance.now();
      setPlaying(false);
    }

    const stream = canvas.captureStream(exportFps);
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cervine-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      analytics.exportCompleted(frameCount);
      setRecording(false);
    };

    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    analytics.exportStarted();

    const durationSeconds = frameCount / fps;
    const sampleCount = Math.max(1, Math.round(durationSeconds * exportFps));
    const msPerSample = 1000 / exportFps;

    for (let i = 0; i < sampleCount; i++) {
      const framePos = (i / exportFps) * fps;
      const wrappedPos = framePos % frameCount;
      drawAtFramePosition(wrappedPos);
      setCurrentFrame(Math.floor(wrappedPos));
      await new Promise<void>((r) => setTimeout(r, msPerSample));
    }

    recorder.stop();
  }, [drawAtFramePosition, fps, frameCount, playing, recording]);

  const totalSecs = (frameCount / fps).toFixed(1);
  const currentSecs = (currentFrame / fps).toFixed(2);

  return (
    <div className={styles.player}>
      <canvas
        ref={canvasRef}
        width={vw}
        height={vh}
        className={styles.canvas}
      />

      <div className={styles.controls}>
        <button onClick={restart} className={styles.btn} title="Restart">
          ↺
        </button>
        <button
          onClick={togglePlay}
          className={styles.btn}
          disabled={recording}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          onClick={toggleEasingMode}
          className={styles.modeBtn}
          disabled={recording}
          title="Motion interpolation easing"
        >
          {easingMode === "smooth" ? "Smooth" : "Linear"}
        </button>
        <input
          type="range"
          min={0}
          max={frameCount - 1}
          step={1}
          value={currentFrame}
          onChange={handleScrub}
          className={styles.scrubber}
          disabled={recording}
        />
        <span className={styles.time}>
          {currentSecs}s / {totalSecs}s
        </span>
        <span className={styles.frameCount}>
          {currentFrame + 1} / {frameCount}
        </span>
      </div>

      <div className={styles.exportRow}>
        {recording ? (
          <span className={styles.exportStatus}>
            <span className={styles.recDot} /> Exporting… {currentFrame + 1}/
            {frameCount}
          </span>
        ) : (
          <button onClick={startExport} className={styles.exportBtn}>
            ↓ Export WebM
          </button>
        )}
      </div>
    </div>
  );
}
