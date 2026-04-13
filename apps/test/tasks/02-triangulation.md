# 02 — Triangulation (mask → wireframe mesh)

Input: α-mask for the current keyframe. Output: a `Mesh` — outline polyline plus interior triangles with varying vertex density.

Target: **≤ 15ms** per keyframe for a typical animal silhouette.

## Target look (from reference)

- Clean outline traced around the silhouette.
- Interior broken into triangles with **varying size** — denser around detail-rich areas (head, legs), coarser across large flat regions (torso).
- Not a uniform grid — looks hand-drawn/low-poly.

## Pipeline

### Step 1 — Outline extraction
- **Marching squares** on the binary mask (threshold α > 0.5) → closed polyline(s).
- Keep only the largest loop (already pre-filtered by CC in detection).
- ~3ms at 960×540.

### Step 2 — Outline simplification
- **Douglas-Peucker** with ε proportional to perimeter (e.g. ε = perimeter / 400 → roughly 80–150 outline vertices for a typical animal).
- Preserve high-curvature points: before DP, compute discrete curvature; protect top-K from removal.
- ~1ms.

### Step 3 — Interior point sampling
Approach: **adaptive Poisson-disk sampling** with density modulated by a "detail map".

- **Detail map** = per-pixel weight that biases density:
  - Start with distance transform from the mask edge (closer to edge = denser).
  - Add gradient magnitude of the source video frame within the mask (textured areas → more vertices).
  - Normalize; use as inverse-radius for Poisson sampling.
- Use **Bridson's Poisson-disk** with per-point radius from the detail map.
- Target count: tunable by user; default ~200–400 interior points for pleasing density.
- ~5ms with a fast-Poisson (Bridson) implementation over a grid.

### Step 4 — Constrained Delaunay triangulation
- Library: **`delaunator`** (main choice — fastest JS Delaunay) + manual constraint enforcement for the outline edges, OR **`cdt2d`** if we need true constrained Delaunay out of the box.
- Input points: outline vertices + interior samples.
- After triangulation, **drop triangles whose centroid falls outside the mask** — this is what carves the shape out.
- ~3ms for ~500 points.

### Step 5 — Mesh record
```ts
type Mesh = {
  vertices: Float32Array;   // [x0,y0, x1,y1, ...] in video-pixel coords
  triangles: Uint32Array;   // triplets of vertex indices
  edges: Uint32Array;       // unique edge pairs (for wireframe render)
  outlineIdx: Uint32Array;  // indices into vertices that form the closed outline, in order
  isOutlineVertex: Uint8Array; // fast lookup flag per vertex
  sourceFrameIdx: number;   // keyframe this mesh was built from
};
```

## Keyframe-to-keyframe: patch, don't rebuild

When a keyframe arrives mid-video, we have a choice:

- **Rebuild** the mesh from scratch — clean but visually resets (triangle identities change → animation pop).
- **Patch** the existing warped mesh to match the new mask — preserves vertex identity → smooth animation.

**Default: patch.** Algorithm:

1. Take the current warped mesh (positions from optical flow).
2. Compare to new mask:
   - Snap outline vertices to the nearest point on the new mask contour (up to a max distance).
   - Drop interior vertices that fell outside the new mask.
   - Add new interior vertices where the mask grew (Poisson-sample only the new region).
3. **Local re-triangulation** — only re-run Delaunay on vertices within a dilated band around added/removed points; leave the rest untouched.

Full rebuild fallback: trigger when >30% of vertices would need patching (topology change).

## Library decisions

- **`delaunator`** — tiny, fast (~3M tris/sec in V8). No built-in constraint support.
- **`poisson-disk-sampling`** or custom Bridson — either works.
- Marching squares: write our own (20 lines; avoids a dep).
- Douglas-Peucker: write our own iterative version (avoids recursion on big outlines).

## Implementation skeleton

```
apps/test/src/lib/mesh/
  ├─ marchingSquares.ts
  ├─ simplify.ts          // Douglas-Peucker + curvature guard
  ├─ detailMap.ts         // distance transform + gradient magnitude
  ├─ poisson.ts           // Bridson with variable radius
  ├─ delaunay.ts          // wrap delaunator + outside-mask cull
  ├─ patch.ts             // keyframe patch-and-local-retriangulate
  └─ types.ts             // Mesh
```

## Tuning knobs exposed later

- Outline simplification ε → controls silhouette fidelity.
- Interior target count → controls density.
- Detail-map weight (edge vs texture) → controls where triangles cluster.
