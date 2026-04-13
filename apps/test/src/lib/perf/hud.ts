type Sample = { total: number; count: number; last: number };

class PerfStore {
  private samples = new Map<string, Sample>();
  private listeners = new Set<() => void>();

  mark(label: string, ms: number) {
    const s = this.samples.get(label) ?? { total: 0, count: 0, last: 0 };
    s.total += ms;
    s.count += 1;
    s.last = ms;
    this.samples.set(label, s);
    this.listeners.forEach((l) => l());
  }

  snapshot(): { label: string; last: number; avg: number; count: number }[] {
    return Array.from(this.samples.entries()).map(([label, s]) => ({
      label,
      last: s.last,
      avg: s.total / s.count,
      count: s.count,
    }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset() {
    this.samples.clear();
    this.listeners.forEach((l) => l());
  }
}

export const perf = new PerfStore();

export async function measure<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    perf.mark(label, performance.now() - start);
  }
}

export function isPerfEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("perf") === "1";
}
