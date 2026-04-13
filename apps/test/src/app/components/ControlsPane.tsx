"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { SeedPoint } from "@/lib/detect";
import {
  detectCurrentFrame,
  detectProvider,
  setFrameForDetection,
} from "@/lib/detect";
import { buildFrame0Mesh } from "@/lib/mesh";
import { processVideoNaive } from "@/lib/pipeline/processVideoNaive";
import { usePipeline } from "@/state/pipeline";
import { getWorker } from "@/state/workers";
import { measure } from "@/lib/perf";

const MAX_DIMENSION = 1080;

function onceVideoEvent(
  video: HTMLVideoElement,
  event: "loadedmetadata" | "loadeddata" | "seeked",
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (event === "loadedmetadata" && video.readyState >= 1) {
      resolve();
      return;
    }
    if (event === "loadeddata" && video.readyState >= 2) {
      resolve();
      return;
    }

    const onResolve = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Unable to decode uploaded video"));
    };
    const cleanup = () => {
      video.removeEventListener(event, onResolve);
      video.removeEventListener("error", onError);
    };

    video.addEventListener(event, onResolve, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function decodeFrameZero(
  file: File,
): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await onceVideoEvent(video, "loadedmetadata");
    await onceVideoEvent(video, "loadeddata");

    const sourceWidth = Math.max(1, video.videoWidth);
    const sourceHeight = Math.max(1, video.videoHeight);
    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(sourceWidth, sourceHeight),
    );
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Unable to decode the first frame");
    }
    context.drawImage(video, 0, 0, width, height);

    const bitmap = await createImageBitmap(canvas);
    return { bitmap, width, height };
  } finally {
    URL.revokeObjectURL(url);
    video.src = "";
  }
}

export function ControlsPane() {
  const settings = usePipeline((s) => s.settings);
  const setSettings = usePipeline((s) => s.setSettings);
  const status = usePipeline((s) => s.status);
  const seedPoint = usePipeline((s) => s.seedPoint);
  const needsSeed = usePipeline((s) => s.needsSeed);
  const setStatus = usePipeline((s) => s.setStatus);
  const setError = usePipeline((s) => s.setError);
  const setVideoFile = usePipeline((s) => s.setVideoFile);
  const setProgress = usePipeline((s) => s.setProgress);
  const setBatchState = usePipeline((s) => s.setBatchState);
  const setFrameResult = usePipeline((s) => s.setFrameResult);
  const setFrame = usePipeline((s) => s.setFrame);
  const setFrameMesh = usePipeline((s) => s.setFrameMesh);
  const setDetection = usePipeline((s) => s.setDetection);
  const setSeed = usePipeline((s) => s.setSeed);
  const setNeedsSeed = usePipeline((s) => s.setNeedsSeed);
  const setPlayback = usePipeline((s) => s.setPlayback);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);

  const [initState, setInitState] = useState<
    | { kind: "idle" }
    | { kind: "initializing" }
    | { kind: "ready"; provider: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const canChangeSubject = useMemo(
    () => needsSeed || seedPoint !== null,
    [needsSeed, seedPoint],
  );

  function stopBatchProcessing() {
    batchAbortRef.current?.abort();
    batchAbortRef.current = null;
  }

  useEffect(() => {
    return () => {
      stopBatchProcessing();
    };
  }, []);

  async function ensurePipelineReady(): Promise<string> {
    const detect = getWorker("detect");
    const flow = getWorker("flow");
    await measure("workers.ready", () =>
      Promise.all([detect.ready, flow.ready]),
    );

    const provider = await measure("provider.detect", () => detectProvider());
    setInitState({ kind: "ready", provider });
    return provider;
  }

  async function runDetection(seed: SeedPoint | null) {
    const result = await measure("detect.frame0", () =>
      detectCurrentFrame(seed),
    );

    const { detection } = result;

    const meshResult = detection
      ? await measure("mesh.frame0", () =>
          Promise.resolve(
            buildFrame0Mesh(
              detection.mask,
              settings.density,
              detection.confidence,
            ),
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
      return { result, meshResult };
    }

    if (result.needsSeed) {
      setStatus("processing");
      return { result, meshResult };
    }

    throw new Error("Detection returned no mask");
  }

  async function startStrictBatch(
    file: File,
    seed: SeedPoint | null,
    startFrame = 1,
  ): Promise<void> {
    if (usePipeline.getState().batchRunning) return;

    stopBatchProcessing();
    const controller = new AbortController();
    batchAbortRef.current = controller;

    const startedAt = performance.now();
    setBatchState({ batchRunning: true, batchElapsedMs: null });
    setStatus("processing");

    try {
      await processVideoNaive({
        file,
        density: usePipeline.getState().settings.density,
        seed,
        maxDimension: MAX_DIMENSION,
        startFrame,
        signal: controller.signal,
        onStart: ({ totalFrames }) => {
          setProgress(
            totalFrames,
            Math.min(totalFrames, Math.max(0, startFrame)),
          );
        },
        onFrame: async (packet) => {
          if (controller.signal.aborted) {
            packet.bitmap.close();
            return;
          }

          const previous = usePipeline.getState().frameBitmap;
          if (previous) previous.close();

          setFrame(packet.bitmap, {
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

  async function initPipeline() {
    setInitState({ kind: "initializing" });
    try {
      await ensurePipelineReady();
    } catch (err) {
      setInitState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onFilePicked(file: File): Promise<void> {
    stopBatchProcessing();
    setError(null);
    setInitState({ kind: "initializing" });
    setStatus("uploading");
    setVideoFile(file);
    setProgress(0, 0);
    setBatchState({ batchRunning: false, batchElapsedMs: null });
    setNeedsSeed(false);
    setSeed(null);
    setDetection(null, null, null);
    setFrameMesh(null, null);
    setUploadName(file.name);

    try {
      await ensurePipelineReady();

      const decoded = await measure("decode.frame0", () =>
        decodeFrameZero(file),
      );
      const previous = usePipeline.getState().frameBitmap;
      if (previous) previous.close();

      setFrame(decoded.bitmap, {
        width: decoded.width,
        height: decoded.height,
      });

      // Transfer a clone to the worker while the UI keeps the preview bitmap.
      const workerBitmap = await createImageBitmap(decoded.bitmap);
      await measure("detect.frame.set", () =>
        setFrameForDetection(workerBitmap),
      );

      setStatus("processing");
      const firstDetection = await runDetection(null);

      if (
        firstDetection.result.detection &&
        firstDetection.meshResult?.mesh &&
        firstDetection.meshResult.frame
      ) {
        void startStrictBatch(file, null, 1);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setInitState({ kind: "error", message });
      setStatus("error");
      setBatchState({ batchRunning: false });
    }
  }

  function onPickVideoClick() {
    fileInputRef.current?.click();
  }

  function onFileInputChanged(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void onFilePicked(file);
    event.target.value = "";
  }

  function onChangeSubject() {
    stopBatchProcessing();
    setSeed(null);
    setNeedsSeed(true);
    setDetection(null, null, "locator-miss");
    setFrameMesh(null, null);
    setBatchState({ batchRunning: false });
    setStatus("processing");
  }

  return (
    <aside className="flex w-90 shrink-0 flex-col gap-6 border-r border-white/10 bg-neutral-950 p-5 text-neutral-200">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Cervine</h1>
        <p className="text-xs text-neutral-500">
          Detect → Triangulate → Animate
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Upload
        </h2>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          onChange={onFileInputChanged}
          className="hidden"
        />
        <div className="rounded-md border border-dashed border-white/15 bg-neutral-900 p-4 text-center text-sm text-neutral-500">
          <button
            type="button"
            onClick={onPickVideoClick}
            className="w-full rounded-md border border-white/20 bg-neutral-800 px-3 py-2 text-sm font-medium text-neutral-200 transition hover:bg-neutral-700"
          >
            Select video
          </button>
          <div className="mt-2 text-xs text-neutral-600">
            mp4, mov, webm · auto-capped to 1080p
          </div>
          {uploadName && (
            <div className="mt-2 truncate text-xs text-neutral-400">
              {uploadName}
            </div>
          )}
        </div>
        {canChangeSubject && (
          <button
            type="button"
            onClick={onChangeSubject}
            className="w-full rounded-md border border-white/20 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800"
          >
            Change subject
          </button>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Controls
        </h2>

        <label className="flex items-center justify-between text-sm">
          <span>Line color</span>
          <input
            type="color"
            value={settings.lineColor}
            onChange={(e) => setSettings({ lineColor: e.target.value })}
            className="h-6 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
            disabled={settings.useSourceColor}
          />
        </label>

        <label className="flex items-center justify-between text-sm">
          <span>Use source color</span>
          <input
            type="checkbox"
            checked={settings.useSourceColor}
            onChange={(e) => setSettings({ useSourceColor: e.target.checked })}
          />
        </label>

        <label className="block space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span>Line width</span>
            <span className="tabular-nums text-neutral-500">
              {settings.lineWidth.toFixed(1)}px
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.1}
            value={settings.lineWidth}
            onChange={(e) => setSettings({ lineWidth: Number(e.target.value) })}
            className="w-full"
          />
        </label>

        <label className="flex items-center justify-between text-sm">
          <span>Background</span>
          <input
            type="color"
            value={settings.backgroundColor}
            onChange={(e) => setSettings({ backgroundColor: e.target.value })}
            className="h-6 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span>Density</span>
          <select
            value={settings.density}
            onChange={(e) =>
              setSettings({
                density: e.target.value as typeof settings.density,
              })
            }
            className="w-full rounded border border-white/10 bg-neutral-900 px-2 py-1"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </section>

      <section className="mt-auto space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Phase 0 check
        </h2>
        <button
          type="button"
          onClick={initPipeline}
          disabled={initState.kind === "initializing"}
          className="w-full rounded-md bg-white px-3 py-2 text-sm font-medium text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {initState.kind === "initializing"
            ? "Initializing…"
            : "Initialize pipeline"}
        </button>
        <div className="min-h-12 rounded border border-white/10 bg-neutral-900 px-3 py-2 font-mono text-xs">
          {initState.kind === "idle" && (
            <span className="text-neutral-500">status: {status}</span>
          )}
          {initState.kind === "initializing" && (
            <span className="text-neutral-400">
              spawning workers + probing GPU…
            </span>
          )}
          {initState.kind === "ready" && (
            <span className="text-emerald-400">
              ✓ workers ready · provider: <strong>{initState.provider}</strong>
            </span>
          )}
          {initState.kind === "error" && (
            <span className="text-rose-400">error: {initState.message}</span>
          )}
        </div>
        <p className="text-xs text-neutral-600">
          Append <code className="text-neutral-400">?perf=1</code> to the URL to
          see the perf HUD.
        </p>
      </section>
    </aside>
  );
}
