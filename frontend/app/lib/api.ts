import type { AnalyzeParams, AnalyzeResult, IngestResult } from "./types";

export class AnalyzeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzeNotFoundError";
  }
}

export async function ingest(blob: Blob, signal: AbortSignal): Promise<IngestResult> {
  const form = new FormData();
  form.append("file", blob, "upload.jpg");

  const res = await fetch("/api/ingest", { method: "POST", body: form, signal });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `ingest failed (${res.status})`);
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
    const detail = await res.text().catch(() => "");
    if (res.status === 404) throw new AnalyzeNotFoundError(detail || "image expired");
    throw new Error(detail || `analyze failed (${res.status})`);
  }
  return (await res.json()) as AnalyzeResult;
}
