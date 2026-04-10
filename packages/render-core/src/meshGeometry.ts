import * as THREE from "three";
import type { Mesh as MeshData, Point } from "@repo/mesh-core";

export type MaterialMode = "wireframe" | "flat" | "lit";

/**
 * Converts a Mesh data object to a Three.js BufferGeometry.
 * Vertices are placed on z=0. The geometry is built once and reused.
 */
export function createMeshGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();

  const positions = new Float32Array(mesh.points.length * 3);
  for (let i = 0; i < mesh.points.length; i++) {
    const p = mesh.points[i];
    if (p === undefined) throw new Error(`Point at index ${i} is undefined`);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = 0;
  }

  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(mesh.triangles);
  geo.computeVertexNormals();

  return geo;
}

/**
 * Creates a Three.js Mesh from geometry with the chosen material mode.
 */
export function createThreeMesh(
  geo: THREE.BufferGeometry,
  mode: MaterialMode = "wireframe"
): THREE.Mesh {
  const mat = buildMaterial(mode);
  return new THREE.Mesh(geo, mat);
}

export function buildMaterial(mode: MaterialMode): THREE.Material {
  switch (mode) {
    case "wireframe":
      return new THREE.MeshBasicMaterial({
        color: 0x4488ff,
        wireframe: true,
      });
    case "flat":
      return new THREE.MeshPhongMaterial({
        color: 0x44aaff,
        flatShading: true,
        side: THREE.DoubleSide,
      });
    case "lit":
    default:
      return new THREE.MeshPhongMaterial({
        color: 0x44aaff,
        flatShading: false,
        side: THREE.DoubleSide,
      });
  }
}

/**
 * Updates position buffer in-place from a new point array.
 * Preserves z and keeps triangle topology fixed.
 * Optionally applies temporal smoothing (alpha in [0,1], 1 = no smoothing).
 */
export function updateGeometryPositions(
  geo: THREE.BufferGeometry,
  points: Point[],
  smoothing = 1
): void {
  const attr = geo.getAttribute("position") as THREE.BufferAttribute;
  if (attr.count !== points.length) {
    console.warn(
      `updateGeometryPositions: point count mismatch (${points.length} vs ${attr.count})`
    );
    return;
  }

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) continue;
    const prevX = attr.getX(i);
    const prevY = attr.getY(i);
    attr.setX(i, prevX + (p.x - prevX) * smoothing);
    attr.setY(i, prevY + (p.y - prevY) * smoothing);
    // z stays at 0
  }

  attr.needsUpdate = true;
  geo.computeVertexNormals();
}
