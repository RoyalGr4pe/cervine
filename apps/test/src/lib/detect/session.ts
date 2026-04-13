import type { InferenceSession } from "onnxruntime-web";
import type { ExecutionProvider } from "./types";

type Ort = typeof import("onnxruntime-web");

let ortPromise: Promise<Ort> | null = null;

async function loadOrt(): Promise<Ort> {
  if (!ortPromise) {
    ortPromise = import("onnxruntime-web").then((mod) => {
      mod.env.wasm.wasmPaths = "/ort/";
      mod.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency ?? 4, 8);
      return mod;
    });
  }
  return ortPromise;
}

export async function detectProvider(): Promise<ExecutionProvider> {
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    try {
      const adapter = await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter();
      if (adapter) return "webgpu";
    } catch {
      // fall through to wasm
    }
  }
  return "wasm";
}

export async function createSession(modelUrl: string): Promise<{
  session: InferenceSession;
  provider: ExecutionProvider;
}> {
  const ort = await loadOrt();
  const provider = await detectProvider();
  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: [provider],
    graphOptimizationLevel: "all",
  });
  return { session, provider };
}

export async function getOrt(): Promise<Ort> {
  return loadOrt();
}
