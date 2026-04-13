# Detection Baseline Report

Generated: 2026-04-13T11:04:32.761Z

## Benchmark Setup

- Frame size: 320x180
- Frames per clip: 90
- Threshold: 60
- Dot spacing (for stability metric): 12
- Detector path: detectObjectFast + border color sampling

## Results

| Clip | Category | Frames | Detection success | Avg ms/frame | Avg dots | Dot CV | Stability score |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple-01 | simple background | 90 | 100.00% | 1.58 | 21.00 | 0.00 | 100.00 |
| Colorful-01 | colorful background | 90 | 100.00% | 1.77 | 374.89 | 0.00 | 99.95 |
| Motion-01 | fast motion | 90 | 91.11% | 1.16 | 7.83 | 0.36 | 96.56 |

## Notes

- Detection success: percent of frames returning a foreground mask.
- Dot CV: coefficient of variation ($std/mean$) for per-frame dot counts.
- Stability score: $100 * max(0, 1 - mean(abs(delta dots))/mean(dots))$.
- This synthetic benchmark gives a repeatable baseline for algorithm comparisons before real-clip tuning.

## Re-run

```bash
pnpm --filter @repo/video-core benchmark:detection
```
