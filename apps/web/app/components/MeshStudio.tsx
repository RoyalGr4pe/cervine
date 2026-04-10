"use client";

import { useRef, useState, useCallback } from "react";
import { processVideo } from "@repo/video-core";
import type { DotAnimation, Dot } from "@repo/video-core";
import { VideoPlayer } from "./VideoPlayer";
import { ObjectOutline } from "./ObjectOutline";
import { ProcessingView } from "./ProcessingView";
import { DotAnimationPlayer } from "./DotAnimationPlayer";
import styles from "./MeshStudio.module.css";

type Phase = "idle" | "processing" | "ready";

export function MeshStudio() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Settings
  const [threshold, setThreshold]     = useState(60);
  const [spacing, setSpacing]         = useState(12);
  const [dotSize, setDotSize]         = useState(5);
  const [dotColor, setDotColor]       = useState<string | null>(null);
  const [colorPickerVal, setColorPickerVal] = useState("#ffffff");

  // State machine
  const [phase, setPhase]             = useState<Phase>("idle");
  const [videoReady, setVideoReady]   = useState(false);
  const [progress, setProgress]       = useState({ done: 0, total: 0, dots: [] as Dot[] });
  const [animation, setAnimation]     = useState<DotAnimation | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleVideoReady = useCallback(() => setVideoReady(true), []);

  const handleProcess = useCallback(async () => {
    const vid = videoRef.current;
    if (!vid) return;

    abortRef.current = new AbortController();
    setPhase("processing");
    setProgress({ done: 0, total: 0, dots: [] });

    try {
      const result = await processVideo(vid, {
        threshold,
        spacing,
        dotColor,
        signal: abortRef.current.signal,
        onProgress: (done, total, dots) => setProgress({ done, total, dots }),
      });
      if (!abortRef.current.signal.aborted) {
        setAnimation(result);
        setPhase("ready");
      }
    } catch (err) {
      console.error("Processing failed:", err);
      setPhase("idle");
    }
  }, [threshold, spacing, dotColor]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setPhase("idle");
  }, []);

  const handleReprocess = useCallback(() => {
    setAnimation(null);
    setPhase("idle");
  }, []);

  return (
    <div className={styles.studio}>
      <h1 className={styles.title}>Cervine — Dot Animation Studio</h1>

      <div className={styles.layout}>
        {/* ---------------------------------------------------------------- */}
        {/* Sidebar                                                           */}
        {/* ---------------------------------------------------------------- */}
        <aside className={styles.sidebar}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Video</h2>
            <VideoPlayer videoRef={videoRef} onVideoReady={handleVideoReady} />
          </section>

          {videoReady && phase !== "processing" && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Settings</h2>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>Threshold</span>
                <input type="range" min={10} max={150} step={5}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className={styles.slider}
                />
                <span className={styles.sliderVal}>{threshold}</span>
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>Spacing</span>
                <input type="range" min={4} max={40} step={2}
                  value={spacing}
                  onChange={(e) => setSpacing(Number(e.target.value))}
                  className={styles.slider}
                />
                <span className={styles.sliderVal}>{spacing}px</span>
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>Dot size</span>
                <input type="range" min={1} max={20} step={1}
                  value={dotSize}
                  onChange={(e) => setDotSize(Number(e.target.value))}
                  className={styles.slider}
                />
                <span className={styles.sliderVal}>{dotSize}px</span>
              </div>

              <div className={styles.colorRow}>
                <span className={styles.sliderLabel}>Dot colour</span>
                <div className={styles.colorOptions}>
                  <button
                    className={`${styles.colorBtn} ${dotColor === null ? styles.active : ""}`}
                    onClick={() => setDotColor(null)}
                  >Source</button>
                  <button
                    className={`${styles.colorBtn} ${dotColor !== null ? styles.active : ""}`}
                    onClick={() => setDotColor(colorPickerVal)}
                  >Fixed</button>
                  <input
                    type="color"
                    value={colorPickerVal}
                    onChange={(e) => {
                      setColorPickerVal(e.target.value);
                      if (dotColor !== null) setDotColor(e.target.value);
                    }}
                    className={styles.colorPicker}
                  />
                </div>
              </div>
            </section>
          )}

          {videoReady && phase === "idle" && (
            <section className={styles.section}>
              <button onClick={handleProcess} className={styles.processBtn}>
                ▶ Process video
              </button>
            </section>
          )}

          {phase === "ready" && (
            <section className={styles.section}>
              <button onClick={handleReprocess} className={styles.reprocessBtn}>
                ↺ Change settings
              </button>
            </section>
          )}
        </aside>

        {/* ---------------------------------------------------------------- */}
        {/* Main area                                                         */}
        {/* ---------------------------------------------------------------- */}
        <main className={styles.canvasArea}>
          {!videoReady && (
            <div className={styles.placeholder}>Upload a video to begin</div>
          )}

          {videoReady && phase === "idle" && (
            <ObjectOutline
              videoRef={videoRef}
              threshold={threshold}
              spacing={spacing}
              dotSize={dotSize}
              dotColor={dotColor}
            />
          )}

          {phase === "processing" && (
            <div className={styles.processingWrapper}>
              <ProcessingView
                processed={progress.done}
                total={progress.total}
                latestDots={progress.dots}
                dotSize={dotSize}
                videoWidth={videoRef.current?.videoWidth ?? 0}
                videoHeight={videoRef.current?.videoHeight ?? 0}
                onCancel={handleCancel}
              />
            </div>
          )}

          {phase === "ready" && animation && (
            <DotAnimationPlayer animation={animation} dotSize={dotSize} />
          )}
        </main>
      </div>
    </div>
  );
}
