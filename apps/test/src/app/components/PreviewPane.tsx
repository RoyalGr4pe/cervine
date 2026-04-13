"use client";

import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { detectCurrentFrame } from "@/lib/detect";
import { buildFrame0Mesh } from "@/lib/mesh";
import { processVideoNaive } from "@/lib/pipeline/processVideoNaive";
import { measure } from "@/lib/perf";
import { drawMesh } from "@/lib/render";
import { usePipeline } from "@/state/pipeline";

const MAX_DIMENSION = 1080;

export function PreviewPane() {
  const status = usePipeline((s) => s.status);
  const settings = usePipeline((s) => s.settings);
  const playback = usePipeline((s) => s.playback);
  const keyframes = usePipeline((s) => s.keyframes);
  const frames = usePipeline((s) => s.frames);
  const totalFrames = usePipeline((s) => s.totalFrames);
  const processedFrames = usePipeline((s) => s.processedFrames);
  const videoFile = usePipeline((s) => s.videoFile);
  const batchRunning = usePipeline((s) => s.batchRunning);
  const batchElapsedMs = usePipeline((s) => s.batchElapsedMs);
  const frameBitmap = usePipeline((s) => s.frameBitmap);
  const frameSize = usePipeline((s) => s.frameSize);
  const currentFrameState =
    frames.get(playback.currentFrame) ?? frames.get(0) ?? null;
  const activeMesh = currentFrameState
    ? (keyframes.get(currentFrameState.keyframeId) ?? null)
    : (keyframes.get(playback.currentFrame) ?? keyframes.get(0) ?? null);
  const detection = usePipeline((s) => s.detection);
  const detectionBBox = usePipeline((s) => s.detectionBBox);
  const detectionReason = usePipeline((s) => s.detectionReason);
  const needsSeed = usePipeline((s) => s.needsSeed);
  const density = usePipeline((s) => s.settings.density);
  const setProgress = usePipeline((s) => s.setProgress);
  const setBatchState = usePipeline((s) => s.setBatchState);
  const setFrameResult = usePipeline((s) => s.setFrameResult);
  const setPlayback = usePipeline((s) => s.setPlayback);
  const setSeed = usePipeline((s) => s.setSeed);
  const setNeedsSeed = usePipeline((s) => s.setNeedsSeed);
  const setFrameMesh = usePipeline((s) => s.setFrameMesh);
  const setDetection = usePipeline((s) => s.setDetection);
  const setStatus = usePipeline((s) => s.setStatus);
  const setError = usePipeline((s) => s.setError);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);

  const progressPct =
    totalFrames > 0
      ? Math.max(0, Math.min(100, (processedFrames / totalFrames) * 100))
      : 0;

  function stopBatchProcessing() {
    batchAbortRef.current?.abort();
    batchAbortRef.current = null;
  }

  useEffect(() => {
    return () => {
      stopBatchProcessing();
    };
  }, []);

  async function startFlowBatchFromSeed(seed: {
    x: number;
    y: number;
  }): Promise<void> {
    if (!videoFile || batchRunning) return;

    stopBatchProcessing();
    const controller = new AbortController();
    batchAbortRef.current = controller;

    const startedAt = performance.now();
    setBatchState({ batchRunning: true, batchElapsedMs: null });
    setStatus("processing");

    try {
      await processVideoNaive({
        file: videoFile,
        density,
        seed,
        maxDimension: MAX_DIMENSION,
        startFrame: 1,
        signal: controller.signal,
        onStart: ({ totalFrames: total }) => {
          setProgress(total, Math.min(total, 1));
        },
        onFrame: async (packet) => {
          if (controller.signal.aborted) {
            packet.bitmap.close();
            return;
          }

          const previous = usePipeline.getState().frameBitmap;
          if (previous) previous.close();

          usePipeline.getState().setFrame(packet.bitmap, {
            width: packet.width,
            height: packet.height,
          });

          setPlayback({ currentFrame: packet.frameIndex });
          setProgress(
            packet.totalFrames,
            Math.min(packet.totalFrames, packet.frameIndex + 1),
          );

          if (packet.mesh && packet.frame) {
            setFrameResult(packet.frameIndex, packet.mesh, packet.frame);
          } else {
            setFrameResult(packet.frameIndex, null, null);
          }

          if (packet.detection) {
            setDetection(
              {
                width: packet.detection.mask.width,
                height: packet.detection.mask.height,
                data: packet.detection.mask.data,
                confidence: packet.detection.confidence,
                source: packet.detection.source,
              },
              packet.detection.bbox,
              packet.reason,
            );
          } else if (packet.reason !== "ok") {
            setDetection(null, null, packet.reason);
          }
        },
      });

      setStatus("ready");
      setBatchState({
        batchRunning: false,
        batchElapsedMs: performance.now() - startedAt,
      });
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (!aborted) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus("error");
      }
      setBatchState({ batchRunning: false });
    } finally {
      if (batchAbortRef.current === controller) {
        batchAbortRef.current = null;
      }
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frameBitmap || !frameSize) return;

    canvas.width = frameSize.width;
    canvas.height = frameSize.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    context.clearRect(0, 0, frameSize.width, frameSize.height);
    context.drawImage(frameBitmap, 0, 0, frameSize.width, frameSize.height);

    const sourceFrame = settings.useSourceColor
      ? context.getImageData(0, 0, frameSize.width, frameSize.height)
      : null;

    if (
      detection &&
      detection.width === frameSize.width &&
      detection.height === frameSize.height
    ) {
      const image = context.createImageData(frameSize.width, frameSize.height);
      for (let i = 0; i < detection.data.length; i += 1) {
        const alpha = Math.min(1, Math.max(0, detection.data[i]));
        const p = i * 4;
        image.data[p] = 196;
        image.data[p + 1] = 196;
        image.data[p + 2] = 196;
        image.data[p + 3] = Math.round(alpha * 180);
      }
      context.putImageData(image, 0, 0);
    }

    if (detectionBBox) {
      context.strokeStyle = "rgba(255,255,255,0.9)";
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      context.strokeRect(
        detectionBBox.x,
        detectionBBox.y,
        detectionBBox.w,
        detectionBBox.h,
      );
      context.setLineDash([]);
    }

    if (needsSeed) {
      context.fillStyle = "rgba(0,0,0,0.42)";
      context.fillRect(0, 0, frameSize.width, frameSize.height);
    }

    if (activeMesh && currentFrameState) {
      drawMesh(context, activeMesh, currentFrameState, {
        lineColor: settings.lineColor,
        lineWidth: settings.lineWidth,
        backgroundColor: settings.backgroundColor,
        useSourceColor: settings.useSourceColor,
        sourceFrame,
      });
    }
  }, [
    frameBitmap,
    frameSize,
    detection,
    detectionBBox,
    needsSeed,
    activeMesh,
    currentFrameState,
    settings,
  ]);

  async function onCanvasClick(event: MouseEvent<HTMLCanvasElement>) {
    if (!needsSeed || !frameSize) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const x = ((event.clientX - rect.left) / rect.width) * frameSize.width;
    const y = ((event.clientY - rect.top) / rect.height) * frameSize.height;
    const seed = {
      x: Math.max(0, Math.min(frameSize.width - 1, x)),
      y: Math.max(0, Math.min(frameSize.height - 1, y)),
    };

    setSeed(seed);
    setNeedsSeed(false);
    setStatus("processing");

    try {
      const result = await measure("detect.seed", () =>
        detectCurrentFrame(seed),
      );

      const { detection } = result;

      const meshResult = detection
        ? await measure("mesh.seed", () =>
            Promise.resolve(
              buildFrame0Mesh(detection.mask, density, detection.confidence),
            ),
          )
        : null;

      setFrameMesh(meshResult?.mesh ?? null, meshResult?.frame ?? null);
      setNeedsSeed(result.needsSeed);
      setDetection(
        detection
          ? {
              width: detection.mask.width,
              height: detection.mask.height,
              data: detection.mask.data,
              confidence: detection.confidence,
              source: detection.source,
            }
          : null,
        detection?.bbox ?? null,
        result.reason,
      );

      if (result.detection) {
        setStatus("ready");
        void startFlowBatchFromSeed(seed);
      } else if (result.needsSeed) {
        setStatus("processing");
      } else {
        setFrameMesh(null, null);
        setStatus("error");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFrameMesh(null, null);
      setError(message);
      setStatus("error");
    }
  }

  return (
    <main className="flex flex-1 flex-col bg-neutral-900">
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        style={{ backgroundColor: settings.backgroundColor }}
      >
        {frameBitmap && frameSize ? (
          <canvas
            ref={canvasRef}
            onClick={(event) => {
              void onCanvasClick(event);
            }}
            className={`max-h-full max-w-full object-contain ${needsSeed ? "cursor-crosshair" : "cursor-default"}`}
          />
        ) : (
          <div className="text-sm text-neutral-500">
            {status === "idle"
              ? "upload a video to begin"
              : `status: ${status}`}
          </div>
        )}

        {frameBitmap && frameSize && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-white/10 bg-neutral-950/95 px-4 py-2 text-xs text-neutral-500 backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-between">
              <span>
                progress: {processedFrames}/{totalFrames || 0}
              </span>
              {batchElapsedMs !== null && (
                <span>{(batchElapsedMs / 1000).toFixed(2)}s</span>
              )}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-white/10">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {batchRunning && (
          <span className="pointer-events-none absolute right-4 top-4 rounded border border-white/20 bg-black/60 px-2 py-1 text-xs text-white">
            processing...
          </span>
        )}
        {needsSeed && frameBitmap && (
          <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md border border-white/25 bg-black/70 px-4 py-2 text-sm text-white">
            Tap the object you want to isolate.
          </div>
        )}
      </div>
      <footer className="flex h-14 items-center gap-3 border-t border-white/10 bg-neutral-950 px-4 text-xs text-neutral-500">
        <span>frame {playback.currentFrame}</span>
        {activeMesh && (
          <span>
            mesh: {Math.floor(activeMesh.vertices.length / 2)}v ·{" "}
            {Math.floor(activeMesh.triangles.length / 3)}t
          </span>
        )}
        {detection && (
          <span>
            source: <strong>{detection.source}</strong> · conf:{" "}
            {detection.confidence.toFixed(2)}
          </span>
        )}
        {!detection && detectionReason && (
          <span>reason: {detectionReason}</span>
        )}
      </footer>
    </main>
  );
}
