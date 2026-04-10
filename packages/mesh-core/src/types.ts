export interface Point {
  x: number;
  y: number;
}

export interface Mesh {
  readonly points: Point[];
  /** Flat array of triangle indices: every 3 elements = one triangle */
  readonly triangles: number[];
}
