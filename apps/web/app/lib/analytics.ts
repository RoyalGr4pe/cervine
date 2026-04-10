declare function gtag(...args: unknown[]): void;

function fire(eventName: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (typeof gtag === "undefined") return;
  gtag("event", eventName, params ?? {});
}

export const analytics = {
  videoUploaded(durationSeconds: number) {
    fire("video_uploaded", { duration_seconds: Math.round(durationSeconds) });
  },

  processingStarted(frameCount: number, spacing: number, threshold: number) {
    fire("processing_started", { frame_count: frameCount, spacing, threshold });
  },

  processingCompleted(frameCount: number, durationMs: number) {
    fire("processing_completed", {
      frame_count: frameCount,
      duration_ms: Math.round(durationMs),
    });
  },

  processingCancelled(framesProcessed: number, total: number) {
    fire("processing_cancelled", { frames_processed: framesProcessed, total });
  },

  exportStarted() {
    fire("export_started");
  },

  exportCompleted(frameCount: number) {
    fire("export_completed", { frame_count: frameCount });
  },
};
