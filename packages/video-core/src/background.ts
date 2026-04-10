/**
 * Incremental background model.
 *
 * Maintains a running per-channel mean of "background" frames so we can
 * subtract it from any later frame to isolate the foreground object.
 *
 * Usage:
 *   const bg = new BackgroundModel();
 *   // feed several frames while the scene is loading / object is stationary
 *   bg.addFrame(frame);
 *   // then use
 *   const mask = bg.buildMask(frame, threshold);
 */
export class BackgroundModel {
  private sum: Float32Array | null = null;
  private count = 0;
  private _width = 0;
  private _height = 0;

  get width() { return this._width; }
  get height() { return this._height; }
  get frameCount() { return this.count; }

  /** Add a frame to the background accumulator. */
  addFrame(frame: ImageData): void {
    const { width, height, data } = frame;
    const n = width * height;

    if (!this.sum) {
      this.sum = new Float32Array(n * 3); // R, G, B channels
      this._width = width;
      this._height = height;
    }

    const sum = this.sum;
    for (let i = 0; i < n; i++) {
      sum[i * 3]     = (sum[i * 3]     ?? 0) + (data[i * 4]     ?? 0); // R
      sum[i * 3 + 1] = (sum[i * 3 + 1] ?? 0) + (data[i * 4 + 1] ?? 0); // G
      sum[i * 3 + 2] = (sum[i * 3 + 2] ?? 0) + (data[i * 4 + 2] ?? 0); // B
    }
    this.count++;
  }

  /**
   * Returns a Uint8Array background image (R,G,B per pixel, no alpha).
   * Caller should check frameCount > 0 first.
   */
  getBackground(): Uint8Array {
    if (!this.sum || this.count === 0) {
      return new Uint8Array(this._width * this._height * 3);
    }
    const n = this._width * this._height;
    const bg = new Uint8Array(n * 3);
    for (let i = 0; i < n * 3; i++) {
      bg[i] = Math.round((this.sum[i] ?? 0) / this.count);
    }
    return bg;
  }

  /**
   * Builds a binary foreground mask by comparing `frame` against the
   * accumulated background.
   *
   * Returns Uint8Array of length width*height: 1 = foreground, 0 = background.
   *
   * @param frame      Current video frame
   * @param threshold  Per-channel difference threshold (0-255). Lower = more
   *                   sensitive. 25–40 works well for clean footage.
   */
  buildMask(frame: ImageData, threshold = 30): Uint8Array {
    if (!this.sum || this.count === 0) {
      // No background yet — treat entire frame as foreground
      return new Uint8Array(this._width * this._height).fill(1);
    }

    const bg = this.getBackground();
    const { data } = frame;
    const n = this._width * this._height;
    const mask = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      const dr = Math.abs((data[i * 4]     ?? 0) - (bg[i * 3]     ?? 0));
      const dg = Math.abs((data[i * 4 + 1] ?? 0) - (bg[i * 3 + 1] ?? 0));
      const db = Math.abs((data[i * 4 + 2] ?? 0) - (bg[i * 3 + 2] ?? 0));
      // A pixel is foreground if any channel differs enough
      mask[i] = (dr > threshold || dg > threshold || db > threshold) ? 1 : 0;
    }

    return mask;
  }

  reset(): void {
    this.sum = null;
    this.count = 0;
    this._width = 0;
    this._height = 0;
  }
}
