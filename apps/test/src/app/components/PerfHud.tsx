"use client";

import { useEffect, useState } from "react";
import { perf, isPerfEnabled } from "@/lib/perf";

export function PerfHud() {
  const [, force] = useState(0);
  const [enabled] = useState(() => isPerfEnabled());

  useEffect(() => {
    if (!enabled) return;
    return perf.subscribe(() => force((n) => n + 1));
  }, [enabled]);

  if (!enabled) return null;
  const samples = perf.snapshot();

  return (
    <div className="fixed bottom-3 right-3 z-50 rounded-md border border-white/20 bg-black/80 px-3 py-2 font-mono text-[11px] text-white shadow-lg backdrop-blur-sm">
      <div className="mb-1 flex items-center justify-between gap-4">
        <span className="font-semibold">perf</span>
        <button
          type="button"
          onClick={() => perf.reset()}
          className="text-white/60 hover:text-white"
        >
          reset
        </button>
      </div>
      {samples.length === 0 ? (
        <div className="text-white/50">no samples yet</div>
      ) : (
        <table>
          <tbody>
            {samples.map((s) => (
              <tr key={s.label}>
                <td className="pr-3">{s.label}</td>
                <td className="pr-2 text-right tabular-nums">
                  {s.last.toFixed(1)}ms
                </td>
                <td className="pr-2 text-right tabular-nums text-white/60">
                  avg {s.avg.toFixed(1)}
                </td>
                <td className="text-right tabular-nums text-white/40">
                  ×{s.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
