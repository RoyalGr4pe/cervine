import * as THREE from "three";

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  dispose: () => void;
  handleResize: (width: number, height: number) => void;
}

/**
 * Bootstraps a Three.js scene on the supplied canvas.
 * The caller is responsible for calling dispose() on unmount.
 */
export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const { clientWidth: w, clientHeight: h } = canvas;
  const camera = new THREE.PerspectiveCamera(60, w / h || 1, 0.1, 1000);
  camera.position.set(0, 0, 1);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h, false);

  // Minimal lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(1, 2, 3);
  scene.add(ambient, dir);

  const handleResize = (width: number, height: number): void => {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const dispose = (): void => {
    renderer.dispose();
  };

  return { scene, camera, renderer, dispose, handleResize };
}
