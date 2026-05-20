// Stencil module surface. Re-exports the algorithm types plus a strategy
// interface that lets a future learned edge model swap in for the classical
// marching-squares extractor without touching the render layer.

export type {
  ContourSet,
  Polyline,
  Point,
  ZoneBoundary,
} from "../algorithms/contours";
export type { LineStyle, StencilColor, StencilStyleOpts } from "./styles";

import type { ContourSet } from "../algorithms/contours";

// Designed-in seam for ML extensions. `ClassicalContourSource` is the v1
// marching-squares implementation; a future `HEDContourSource` would run a
// holistically-nested edge detector (e.g. via onnxruntime-web) on `gray` and
// quantize each detected edge to a `level` from the local zone gradient.
export interface ContourSource {
  extract(input: {
    zoneIndex: Uint8Array;
    gray?: Uint8Array;
    width: number;
    height: number;
    n: number;
  }): Promise<ContourSet>;
}
