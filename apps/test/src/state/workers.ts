type WorkerKind = "detect" | "flow";

type WorkerEntry = { worker: Worker; ready: Promise<void> };

const workers = new Map<WorkerKind, WorkerEntry>();

export function getWorker(kind: WorkerKind): WorkerEntry {
  let entry = workers.get(kind);
  if (!entry) {
    const worker =
      kind === "detect"
        ? new Worker(new URL("../workers/detect.worker.ts", import.meta.url), { type: "module" })
        : new Worker(new URL("../workers/flow.worker.ts", import.meta.url), { type: "module" });

    const ready = new Promise<void>((resolve) => {
      const onMessage = (e: MessageEvent) => {
        if (e.data?.type === "ready") {
          worker.removeEventListener("message", onMessage);
          resolve();
        }
      };
      worker.addEventListener("message", onMessage);
    });

    entry = { worker, ready };
    workers.set(kind, entry);
  }
  return entry;
}

export function disposeWorkers(): void {
  workers.forEach(({ worker }) => worker.terminate());
  workers.clear();
}
