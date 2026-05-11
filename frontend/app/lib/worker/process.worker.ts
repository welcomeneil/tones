// Web Worker that owns image processing for the tonal-zone pipeline.
// Holds the grayscale buffer + 256-bin histogram for the current image
// so re-analyze under new params (`n`) is sub-millisecond.

import {
  bitmapToGrayscale,
  buildZoneIndexImageData,
  computeHistogram,
  DegenerateImageError,
  digitize,
  paintZoneMap,
  paletteFromZones,
  requireTonalVariation,
} from "../algorithms/shared";
import { runKmeans1D } from "../algorithms/kmeans1d";

export type LoadMsg = { type: "load"; id: number; blob: Blob };
export type AnalyzeMsg = {
  type: "analyze";
  id: number;
  n: number;
};
export type ResetMsg = { type: "reset" };
export type InMsg = LoadMsg | AnalyzeMsg | ResetMsg;

export type LoadOk = {
  type: "load_ok";
  id: number;
  width: number;
  height: number;
};
export type AnalyzeOk = {
  type: "analyze_ok";
  id: number;
  width: number;
  height: number;
  n: number;
  palette: number[];
  zoneMap: ImageBitmap;
  zoneIndexData: ImageData;
};
export type ErrorOut = {
  type: "error";
  id: number;
  code: string;
  message: string;
};
export type OutMsg = LoadOk | AnalyzeOk | ErrorOut;

const ctx = self as unknown as {
  postMessage: (data: OutMsg, transfer?: Transferable[]) => void;
  onmessage: ((e: MessageEvent<InMsg>) => void) | null;
};

let cached: {
  gray: Uint8Array;
  histogram: Uint32Array;
  width: number;
  height: number;
} | null = null;

ctx.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;

  if (msg.type === "reset") {
    cached = null;
    return;
  }

  try {
    if (msg.type === "load") {
      const bitmap = await createImageBitmap(msg.blob);
      const { gray, width, height } = bitmapToGrayscale(bitmap);
      bitmap.close();
      const histogram = computeHistogram(gray);
      cached = { gray, histogram, width, height };
      ctx.postMessage({ type: "load_ok", id: msg.id, width, height });
      return;
    }

    if (msg.type === "analyze") {
      if (!cached) {
        ctx.postMessage({
          type: "error",
          id: msg.id,
          code: "no_image",
          message: "no image loaded",
        });
        return;
      }
      requireTonalVariation(cached.histogram);

      const { boundaries, zoneCount } = runKmeans1D(cached.histogram, msg.n);

      const zones = digitize(cached.gray, boundaries);
      const palette = paletteFromZones(cached.gray, zones, zoneCount);
      const effectiveZoneCount = palette.length;

      const zoneMap = paintZoneMap(zones, palette, cached.width, cached.height);
      const zoneIndexData = buildZoneIndexImageData(
        zones,
        cached.width,
        cached.height,
      );

      ctx.postMessage(
        {
          type: "analyze_ok",
          id: msg.id,
          width: cached.width,
          height: cached.height,
          n: effectiveZoneCount,
          palette,
          zoneMap,
          zoneIndexData,
        },
        [zoneMap, zoneIndexData.data.buffer],
      );
      return;
    }
  } catch (err: unknown) {
    const code =
      err instanceof DegenerateImageError ? err.code : "process_failed";
    const message = err instanceof Error ? err.message : "process failed";
    ctx.postMessage({ type: "error", id: msg.id, code, message });
  }
};

// Make this file an ES module (required for Next.js worker bundling).
export {};
