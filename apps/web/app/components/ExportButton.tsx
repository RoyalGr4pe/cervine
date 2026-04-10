"use client";

import { useRef, useState, useCallback, type RefObject } from "react";
import styles from "./ExportButton.module.css";

interface Props {
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export function ExportButton({ canvasRef }: Props) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const stream = canvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : null;

    if (!mimeType) {
      setError("WebM recording is not supported in this browser.");
      return;
    }

    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cervine-export-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      setRecording(false);
    };

    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    setError(null);
  }, [canvasRef]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  return (
    <div className={styles.container}>
      {error && <span className={styles.error}>{error}</span>}
      {recording ? (
        <button onClick={stopRecording} className={styles.stopBtn}>
          ■ Stop &amp; Download
        </button>
      ) : (
        <button onClick={startRecording} className={styles.startBtn}>
          ● Record WebM
        </button>
      )}
    </div>
  );
}
