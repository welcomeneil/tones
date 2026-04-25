import type { AnalyzeParams, AnalyzeResult } from "./types";

export async function analyze(
  blob: Blob,
  params: AnalyzeParams,
  signal: AbortSignal,
): Promise<AnalyzeResult> {
  const form = new FormData();
  form.append("file", blob, "upload.jpg");
  form.append("algo", params.algo);
  form.append("n", String(params.n));
  form.append("sigma", String(params.sigma));

  const res = await fetch("/api/analyze", {
    method: "POST",
    body: form,
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `analyze failed (${res.status})`);
  }

  return (await res.json()) as AnalyzeResult;
}
