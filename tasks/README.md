# Video -> Animated Mesh Task Pack

This folder contains the implementation plan for the Video -> Animated Mesh MVP.

Extended planning packs:

- [15-dot-studio-improvements.md](15-dot-studio-improvements.md)

Goal:

- Finish planning first
- Implement incrementally from Task 1 to Task 14
- Keep mesh topology fixed after initial creation

## Execution Rules

1. Do not skip ahead to optical flow before MVP motion works.
2. Do not rebuild triangulation each frame.
3. Keep point counts in the 100-300 range for MVP.
4. Complete Definition of Done for each task before moving on.

## Recommended Order

1. [01-setup-monorepo.md](01-setup-monorepo.md)
2. [02-video-upload-playback.md](02-video-upload-playback.md)
3. [03-frame-extraction.md](03-frame-extraction.md)
4. [04-point-generation.md](04-point-generation.md)
5. [05-mesh-generation-delaunay.md](05-mesh-generation-delaunay.md)
6. [06-three-scene-setup.md](06-three-scene-setup.md)
7. [07-mesh-to-geometry.md](07-mesh-to-geometry.md)
8. [08-render-loop.md](08-render-loop.md)
9. [09-animate-vertices-fake-motion.md](09-animate-vertices-fake-motion.md)
10. [10-sync-with-video-time.md](10-sync-with-video-time.md)
11. [11-real-motion-tracking.md](11-real-motion-tracking.md)
12. [12-update-geometry-with-tracked-points.md](12-update-geometry-with-tracked-points.md)
13. [13-styling-and-materials.md](13-styling-and-materials.md)
14. [14-export.md](14-export.md)
15. [15-dot-studio-improvements.md](15-dot-studio-improvements.md)

## MVP Completion Checklist

- User uploads a video and playback works.
- Initial points are generated from frame size.
- Delaunay mesh is generated once from initial points.
- Three.js scene renders mesh at interactive frame rates.
- Vertex animation responds to video time.
- Geometry updates in place without re-triangulation.
