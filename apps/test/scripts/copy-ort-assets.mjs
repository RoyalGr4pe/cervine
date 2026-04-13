import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "node_modules", "onnxruntime-web", "dist");
const dest = resolve(here, "..", "public", "ort");

const files = [
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
];

mkdirSync(dest, { recursive: true });
for (const f of files) {
  try {
    copyFileSync(resolve(src, f), resolve(dest, f));
  } catch (err) {
    console.warn(`[copy-ort-assets] skipped ${f}: ${err.message}`);
  }
}
console.log(`[copy-ort-assets] copied ${files.length} files to public/ort/`);
