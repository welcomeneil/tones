// Worker-backed image processor. Replaces the previous network-based
// ingest/analyze pair; everything now runs on the client. The worker
// caches the grayscale buffer + 256-bin histogram so re-analyze on a
// new `n` / `sigma` / `algo` skips the upload and re-decode entirely.

import type { AnalyzeOk } from "./worker/process.worker";
import { ProcessWorkerClient, WorkerError } from "./worker/client";
import type { AnalyzeResult } from "./types";

export { ProcessWorkerClient, WorkerError };

export type AnalyzedAssets = {
  result: AnalyzeResult;
  zoneMap: ImageBitmap;
  zoneIndexData: ImageData;
};

export function toAnalyzedAssets(msg: AnalyzeOk): AnalyzedAssets {
  return {
    result: {
      width: msg.width,
      height: msg.height,
      algo: msg.algo,
      n: msg.n,
      palette: msg.palette,
    },
    zoneMap: msg.zoneMap,
    zoneIndexData: msg.zoneIndexData,
  };
}
