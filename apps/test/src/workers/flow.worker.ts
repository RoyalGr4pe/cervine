/// <reference lib="webworker" />

export type FlowOutMsg = { type: "ready" } | { type: "pong" };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.postMessage({ type: "ready" } satisfies FlowOutMsg);

ctx.addEventListener("message", (e: MessageEvent) => {
  if (e.data?.type === "ping") {
    ctx.postMessage({ type: "pong" } satisfies FlowOutMsg);
  }
});
