import type { AnalyzeParams, AnalyzeResult, IngestResult } from "./types";

export class AnalyzeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeNotFoundError";
  }
}

// FastAPI returns errors as { detail: string }. Upstream/edge failures may
// return HTML or plain text. Pull out the friendly message when we can,
// fall back to a generic "request failed (status)" otherwise — never dump
// raw JSON or HTML into the UI.
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const data = (await res.json()) as unknown;
      if (
        data &&
        typeof data === "object" &&
        "detail" in data &&
        typeof (data as { detail: unknown }).detail === "string"
      ) {
        return (data as { detail: string }).detail;
      }
      return fallback;
    }
    const text = (await res.text()).trim();
    if (!text || text.startsWith("<") || text.length > 200) return fallback;
    return text;
  } catch {
    return fallback;
  }
}

export async function ingest(blob: Blob, signal: AbortSignal): Promise<IngestResult> {
  const form = new FormData();
  form.append("file", blob, "upload.jpg");

  const res = await fetch("/api/ingest", { method: "POST", body: form, signal });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `ingest failed (${res.status})`));
  }
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
  if (!res.ok) {
    const message = await readErrorMessage(res, `analyze failed (${res.status})`);
    if (res.status === 404) throw new AnalyzeNotFoundError(message);
    throw new Error(message);
  }
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
