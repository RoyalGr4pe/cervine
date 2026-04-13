export type Mesh = {
  vertices: Float32Array;
  triangles: Uint32Array;
  edges: Uint32Array;
  outlineIdx: Uint32Array;
  isOutlineVertex: Uint8Array;
  sourceFrameIdx: number;
};

export type FrameState = {
  keyframeId: number;
  vertices: Float32Array;
  confidence: number;
};
