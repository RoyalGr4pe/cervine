// Reusable off-screen canvas singleton — no extra allocations per call.
let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;

function getContext(
  width: number,
  height: number
): CanvasRenderingContext2D | null {
  if (!_canvas) {
    _canvas = document.createElement("canvas");
  }
  if (_canvas.width !== width || _canvas.height !== height) {
    _canvas.width = width;
    _canvas.height = height;
  }
  if (!_ctx) {
    _ctx = _canvas.getContext("2d");
  }
  return _ctx;
}

/**
 * Captures the current frame of an HTMLVideoElement and returns its RGBA pixel data.
 * Returns null if the video is not ready or dimensions are unavailable.
 */
export function extractFrame(video: HTMLVideoElement): ImageData | null {
  const { videoWidth: w, videoHeight: h } = video;
  if (!w || !h) return null;
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;

  const ctx = getContext(w, h);
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
