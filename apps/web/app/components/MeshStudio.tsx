"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { processVideo } from "@repo/video-core";
import type { DotAnimation, Dot } from "@repo/video-core";
import { analytics } from "../lib/analytics";
import { VideoPlayer } from "./VideoPlayer";
import { ObjectOutline } from "./ObjectOutline";
import { ProcessingView } from "./ProcessingView";
import { DotAnimationPlayer } from "./DotAnimationPlayer";
import type { MeshColorMode, RenderMode } from "./renderModes";
import { createMlMaskProvider } from "./mlMaskProvider";
import styles from "./MeshStudio.module.css";

type Phase = "idle" | "processing" | "ready";

export function MeshStudio() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Settings
  const [threshold, setThreshold] = useState(60);
  const [spacing, setSpacing] = useState(12);
  const [dotSize, setDotSize] = useState(5);
  const [dotColor, setDotColor] = useState<string | null>(null);
  const [detectorMode, setDetectorMode] = useState<"classic" | "ml">("classic");
  const [renderMode, setRenderMode] = useState<RenderMode>("dots");
  const [meshLineWidth, setMeshLineWidth] = useState(1.2);
  const [meshColorMode, setMeshColorMode] = useState<MeshColorMode>("average");
  const [colorPickerVal, setColorPickerVal] = useState("#ffffff");

  // State machine
  const [phase, setPhase] = useState<Phase>("idle");
  const [videoReady, setVideoReady] = useState(false);
  const [progress, setProgress] = useState({
    done: 0,
    total: 0,
    dots: [] as Dot[],
  });
  const [animation, setAnimation] = useState<DotAnimation | null>(null);
  const [previewStatus, setPreviewStatus] = useState<
    "live" | "updating" | "ready"
  >("ready");
  const abortRef = useRef<AbortController | null>(null);
  const mlMaskProviderRef = useRef<ReturnType<
    typeof createMlMaskProvider
  > | null>(null);

  useEffect(() => {
    if (detectorMode === "ml" && !mlMaskProviderRef.current) {
      mlMaskProviderRef.current = createMlMaskProvider();
    }
  }, [detectorMode]);

  const handleVideoReady = useCallback(() => setVideoReady(true), []);

  useEffect(() => {
    if (!videoReady || phase !== "idle") return;
    setPreviewStatus("updating");
    const t = window.setTimeout(() => setPreviewStatus("live"), 120);
    return () => window.clearTimeout(t);
  }, [
    videoReady,
    phase,
    threshold,
    spacing,
    dotSize,
    dotColor,
    renderMode,
    meshLineWidth,
    meshColorMode,
  ]);

  const handleProcess = useCallback(async () => {
    const vid = videoRef.current;
    if (!vid) return;

    abortRef.current = new AbortController();
    setPhase("processing");
    setProgress({ done: 0, total: 0, dots: [] });

    const startedAt = performance.now();
    const estimatedFrames = Math.round((vid.duration ?? 0) * 30);
    analytics.processingStarted(estimatedFrames, spacing, threshold);

    try {
      const result = await processVideo(vid, {
        threshold,
        spacing,
        samplingPattern: renderMode === "delaunay" ? "triangular" : "grid",
        dotColor,
        detectorMode,
        mlMaskProvider:
          detectorMode === "ml"
            ? (mlMaskProviderRef.current ?? undefined)
            : undefined,
        signal: abortRef.current.signal,
        onProgress: (done, total, dots) => setProgress({ done, total, dots }),
      });
      if (!abortRef.current.signal.aborted) {
        analytics.processingCompleted(
          result.frameCount,
          performance.now() - startedAt,
        );
        setAnimation(result);
        setPhase("ready");
      }
    } catch (err) {
      console.error("Processing failed:", err);
      setPhase("idle");
    }
  }, [threshold, spacing, dotColor, detectorMode, renderMode]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    analytics.processingCancelled(progress.done, progress.total);
    setPhase("idle");
  }, [progress.done, progress.total]);

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
                <input
                  type="range"
                  min={10}
                  max={150}
                  step={5}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className={styles.slider}
                />
                <span className={styles.sliderVal}>{threshold}</span>
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>Spacing</span>
                <input
                  type="range"
                  min={4}
                  max={40}
                  step={2}
                  value={spacing}
                  onChange={(e) => setSpacing(Number(e.target.value))}
                  className={styles.slider}
                />
                <span className={styles.sliderVal}>{spacing}px</span>
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>Dot size</span>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={1}
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
                  >
                    Source
                  </button>
                  <button
                    className={`${styles.colorBtn} ${dotColor !== null ? styles.active : ""}`}
                    onClick={() => setDotColor(colorPickerVal)}
                  >
                    Fixed
                  </button>
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

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>Detector</span>
                <div className={styles.colorOptions}>
                  <button
                    className={`${styles.colorBtn} ${detectorMode === "classic" ? styles.active : ""}`}
                    onClick={() => setDetectorMode("classic")}
                  >
                    Classic
                  </button>
                  <button
                    className={`${styles.colorBtn} ${detectorMode === "ml" ? styles.active : ""}`}
                    onClick={() => {
                      if (!mlMaskProviderRef.current) {
                        mlMaskProviderRef.current = createMlMaskProvider();
                      }
                      setDetectorMode("ml");
                    }}
                  >
                    ML (client)
                  </button>
                </div>
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>Display</span>
                <div className={styles.colorOptions}>
                  <button
                    className={`${styles.colorBtn} ${renderMode === "dots" ? styles.active : ""}`}
                    onClick={() => setRenderMode("dots")}
                  >
                    Dots
                  </button>
                  <button
                    className={`${styles.colorBtn} ${renderMode === "delaunay" ? styles.active : ""}`}
                    onClick={() => setRenderMode("delaunay")}
                  >
                    Delaunay
                  </button>
                </div>
              </div>

              {renderMode === "delaunay" && (
                <>
                  <div className={styles.sliderRow}>
                    <span className={styles.sliderLabel}>Line width</span>
                    <input
                      type="range"
                      min={0.5}
                      max={4}
                      step={0.1}
                      value={meshLineWidth}
                      onChange={(e) => setMeshLineWidth(Number(e.target.value))}
                      className={styles.slider}
                    />
                    <span className={styles.sliderVal}>
                      {meshLineWidth.toFixed(1)}
                    </span>
                  </div>

                  <div className={styles.sliderRow}>
                    <span className={styles.sliderLabel}>Mesh colour</span>
                    <div className={styles.colorOptions}>
                      <button
                        className={`${styles.colorBtn} ${meshColorMode === "average" ? styles.active : ""}`}
                        onClick={() => setMeshColorMode("average")}
                      >
                        From dots
                      </button>
                      <button
                        className={`${styles.colorBtn} ${meshColorMode === "single" ? styles.active : ""}`}
                        onClick={() => setMeshColorMode("single")}
                      >
                        Single
                      </button>
                    </div>
                  </div>
                </>
              )}

              <p className={styles.hint}>Live preview: {previewStatus}</p>
              {detectorMode === "ml" && (
                <p className={styles.hint}>
                  ML preview runs at sampled intervals to keep UI responsive.
                </p>
              )}
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
              renderMode={renderMode}
              meshLineWidth={meshLineWidth}
              meshColorMode={meshColorMode}
              detectorMode={detectorMode}
              mlMaskProvider={mlMaskProviderRef.current ?? undefined}
            />
          )}

          {phase === "processing" && (
            <div className={styles.processingWrapper}>
              <ProcessingView
                processed={progress.done}
                total={progress.total}
                latestDots={progress.dots}
                dotSize={dotSize}
                renderMode={renderMode}
                meshLineWidth={meshLineWidth}
                meshColorMode={meshColorMode}
                dotColor={dotColor}
                videoWidth={videoRef.current?.videoWidth ?? 0}
                videoHeight={videoRef.current?.videoHeight ?? 0}
                onCancel={handleCancel}
              />
            </div>
          )}

          {phase === "ready" && animation && (
            <DotAnimationPlayer
              animation={animation}
              dotSize={dotSize}
              renderMode={renderMode}
              meshLineWidth={meshLineWidth}
              meshColorMode={meshColorMode}
              meshSingleColor={dotColor}
            />
          )}
        </main>
      </div>
    </div>
  );
}
