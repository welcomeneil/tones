import type { AnalyzeParams, AnalyzeResult, IngestResult } from "./types";

// All API errors carry a machine-readable code and a human-readable message.
// The contract: every non-2xx response from /api/* is JSON of shape
// { error: { code, message } }. This is enforced by the proxy layer.
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readEnvelope(res: Response): Promise<ApiError> {
  let code = "unknown";
  let message = `request failed (${res.status})`;
  try {
    const data = (await res.json()) as unknown;
    if (
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "object" &&
      (data as { error: object }).error !== null
    ) {
      const err = (data as { error: { code?: unknown; message?: unknown } }).error;
      if (typeof err.code === "string") code = err.code;
      if (typeof err.message === "string") message = err.message;
    }
  } catch {
    // Body wasn't JSON; keep the generic fallback.
  }
  return new ApiError(code, message, res.status);
}

export async function ingest(blob: Blob, signal: AbortSignal): Promise<IngestResult> {
  const form = new FormData();
  form.append("file", blob, "upload.jpg");

  const res = await fetch("/api/ingest", { method: "POST", body: form, signal });
  if (!res.ok) throw await readEnvelope(res);
  return (await res.json()) as IngestResult;
}

export async function analyze(
  id: string,
  params: AnalyzeParams,
  signal: AbortSignal,
): Promise<AnalyzeResult> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, algo: params.algo, n: params.n, sigma: params.sigma }),
    signal,
  });
  if (!res.ok) throw await readEnvelope(res);
  return (await res.json()) as AnalyzeResult;
}

export type AnalyzedAssets = {
  result: AnalyzeResult;
  zoneMap: ImageBitmap;
  zoneIndexData: ImageData;
};

export async function fetchAnalyzedAssets(
  result: AnalyzeResult,
  signal: AbortSignal,
): Promise<AnalyzedAssets> {
  const [flatBlob, indexBlob] = await Promise.all([
    fetch(result.mapUrl, { signal }).then((r) => r.blob()),
    fetch(result.indexUrl, { signal }).then((r) => r.blob()),
  ]);
  const [zoneMap, indexBitmap] = await Promise.all([
    createImageBitmap(flatBlob),
    createImageBitmap(indexBlob),
  ]);
  if (signal.aborted) {
    zoneMap.close();
    indexBitmap.close();
    throw new DOMException("aborted", "AbortError");
  }
  const offscreen = new OffscreenCanvas(result.width, result.height);
  const ctx = offscreen.getContext("2d");
  if (!ctx) {
    zoneMap.close();
    indexBitmap.close();
    throw new Error("failed to create 2d context");
  }
  ctx.drawImage(indexBitmap, 0, 0);
  const zoneIndexData = ctx.getImageData(0, 0, result.width, result.height);
  indexBitmap.close();
  return { result, zoneMap, zoneIndexData };
}
