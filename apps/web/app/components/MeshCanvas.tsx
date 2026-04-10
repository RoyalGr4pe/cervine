"use client";

import { forwardRef, type RefObject } from "react";
import type { MaterialMode } from "@repo/render-core";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  materialMode: MaterialMode;
  width: number;
  height: number;
}

/** Placeholder — mesh pipeline is being rebuilt. */
export const MeshCanvas = forwardRef<HTMLCanvasElement, Props>(
  function MeshCanvas(_props, _ref) {
    return null;
  }
);
