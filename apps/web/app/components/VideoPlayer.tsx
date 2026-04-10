"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type RefObject,
} from "react";
import styles from "./VideoPlayer.module.css";
import { analytics } from "../lib/analytics";

interface VideoState {
  duration: number;
  currentTime: number;
  playing: boolean;
}

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  onVideoReady?: (video: HTMLVideoElement) => void;
}

export function VideoPlayer({ videoRef, onVideoReady }: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [videoState, setVideoState] = useState<VideoState>({
    duration: 0,
    currentTime: 0,
    playing: false,
  });

  // Cleanup object URL on unmount or when file changes
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setObjectUrl(URL.createObjectURL(file));
      setVideoState({ duration: 0, currentTime: 0, playing: false });
    },
    [objectUrl]
  );

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoState((s) => ({ ...s, duration: video.duration }));
    analytics.videoUploaded(video.duration);
    onVideoReady?.(video);
  }, [videoRef, onVideoReady]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoState((s) => ({ ...s, currentTime: video.currentTime }));
  }, [videoRef]);

  const handlePlay = useCallback(() => {
    setVideoState((s) => ({ ...s, playing: true }));
  }, []);

  const handlePause = useCallback(() => {
    setVideoState((s) => ({ ...s, playing: false }));
  }, []);

  const fmt = (t: number) => {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2).padStart(5, "0");
    return `${m}:${s}`;
  };

  return (
    <div className={styles.container}>
      <label className={styles.uploadLabel}>
        <input
          type="file"
          accept="video/*"
          onChange={handleFileChange}
          className={styles.fileInput}
        />
        {objectUrl ? "Change video" : "Upload video"}
      </label>

      {objectUrl && (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            src={objectUrl}
            controls
            className={styles.video}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPlay={handlePlay}
            onPause={handlePause}
            playsInline
          />
          <div className={styles.timeInfo}>
            <span>{fmt(videoState.currentTime)}</span>
            <span>/</span>
            <span>{fmt(videoState.duration)}</span>
            <span className={styles.status}>
              {videoState.playing ? "▶ Playing" : "⏸ Paused"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
