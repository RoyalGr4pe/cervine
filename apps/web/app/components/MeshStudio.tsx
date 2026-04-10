"use client";

import { useRef, useState, useCallback } from "react";
import { VideoPlayer } from "./VideoPlayer";
import { ObjectOutline } from "./ObjectOutline";
import styles from "./MeshStudio.module.css";

export function MeshStudio() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [threshold, setThreshold] = useState(60);
  const [spacing, setSpacing] = useState(12);
  const [dotSize, setDotSize] = useState(5);
  // null = sample from image, string = fixed colour
  const [dotColor, setDotColor] = useState<string | null>(null);
  const [colorPickerVal, setColorPickerVal] = useState("#ffffff");

  const handleVideoReady = useCallback(() => setVideoReady(true), []);

  return (
    <div className={styles.studio}>
      <h1 className={styles.title}>Cervine — Object Detection</h1>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Video</h2>
            <VideoPlayer videoRef={videoRef} onVideoReady={handleVideoReady} />
          </section>

          {videoReady && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Settings</h2>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>Threshold</span>
                <input
                  type="range" min={10} max={150} step={5}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className={styles.slider}
                />
                <span className={styles.sliderVal}>{threshold}</span>
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>Spacing</span>
                <input
                  type="range" min={4} max={40} step={2}
                  value={spacing}
                  onChange={(e) => setSpacing(Number(e.target.value))}
                  className={styles.slider}
                />
                <span className={styles.sliderVal}>{spacing}px</span>
              </div>

              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>Dot size</span>
                <input
                  type="range" min={1} max={20} step={1}
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
                    title="Pick colour"
                  />
                </div>
              </div>
            </section>
          )}
        </aside>

        <main className={styles.canvasArea}>
          {videoReady ? (
            <ObjectOutline
              videoRef={videoRef}
              threshold={threshold}
              spacing={spacing}
              dotSize={dotSize}
              dotColor={dotColor}
            />
          ) : (
            <div className={styles.placeholder}>Upload a video to begin</div>
          )}
        </main>
      </div>
    </div>
  );
}
