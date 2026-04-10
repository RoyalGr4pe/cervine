"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { DotAnimation } from "@repo/video-core";
import styles from "./DotAnimationPlayer.module.css";
import { analytics } from "../lib/analytics";

interface Props {
  animation: DotAnimation;
  dotSize: number;
}

export function DotAnimationPlayer({ animation, dotSize }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement | null>(null);
  const rafRef      = useRef<number | null>(null);
  const startRef    = useRef<number | null>(null);
  const offsetRef   = useRef(0);
  const pausedAtRef = useRef<number | null>(null);

  const [playing, setPlaying]       = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);

  // Export state
  const [recording, setRecording]   = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);

  const { frames, fps, frameCount, videoWidth: vw, videoHeight: vh } = animation;

  const drawFrame = useCallback((idx: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, vw, vh);
    const dots = frames[idx];
    if (!dots) return;
    for (const dot of dots) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dotSize, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${dot.r},${dot.g},${dot.b})`;
      ctx.fill();
    }
  }, [frames, vw, vh, dotSize]);

  useEffect(() => {
    if (!playing) drawFrame(currentFrame);
  }, [dotSize, currentFrame, playing, drawFrame]);

  useEffect(() => {
    if (!playing) return;
    const loop = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = (now - startRef.current - offsetRef.current) / 1000;
      const idx = Math.floor(elapsed * fps) % frameCount;
      setCurrentFrame(idx);
      drawFrame(idx);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [playing, fps, frameCount, drawFrame]);

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
    startRef.current  = null;
    offsetRef.current = 0;
    pausedAtRef.current = null;
    setCurrentFrame(0);
    setPlaying(true);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = Number(e.target.value);
    if (playing) { pausedAtRef.current = performance.now(); setPlaying(false); }
    if (startRef.current !== null) {
      offsetRef.current = performance.now() - startRef.current - (idx / fps) * 1000;
    }
    setCurrentFrame(idx);
    drawFrame(idx);
  };

  // -------------------------------------------------------------------------
  // Export: render all frames to the canvas at fps rate, record via MediaRecorder
  // -------------------------------------------------------------------------
  const startExport = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || recording) return;

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    // Stop playback while exporting
    if (playing) { pausedAtRef.current = performance.now(); setPlaying(false); }

    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
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

    // Step through every frame at real fps timing
    const msPerFrame = 1000 / fps;
    for (let i = 0; i < frameCount; i++) {
      drawFrame(i);
      setCurrentFrame(i);
      await new Promise<void>((r) => setTimeout(r, msPerFrame));
    }

    recorder.stop();
  }, [recording, playing, fps, frameCount, drawFrame]);

  const totalSecs   = (frameCount / fps).toFixed(1);
  const currentSecs = (currentFrame / fps).toFixed(2);

  return (
    <div className={styles.player}>
      <canvas ref={canvasRef} width={vw} height={vh} className={styles.canvas} />

      <div className={styles.controls}>
        <button onClick={restart} className={styles.btn} title="Restart">↺</button>
        <button onClick={togglePlay} className={styles.btn} disabled={recording}>
          {playing ? "⏸" : "▶"}
        </button>
        <input
          type="range" min={0} max={frameCount - 1} step={1}
          value={currentFrame}
          onChange={handleScrub}
          className={styles.scrubber}
          disabled={recording}
        />
        <span className={styles.time}>{currentSecs}s / {totalSecs}s</span>
        <span className={styles.frameCount}>{currentFrame + 1} / {frameCount}</span>
      </div>

      <div className={styles.exportRow}>
        {recording ? (
          <span className={styles.exportStatus}>
            <span className={styles.recDot} /> Exporting… {currentFrame + 1}/{frameCount}
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
