import {
  MAX_INGEST_BYTES,
  envelopeResponse,
  getOrCreateRequestId,
  proxyUpstream,
} from "../_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request);

  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_INGEST_BYTES) {
    return envelopeResponse(
      413,
      "payload_too_large",
      "uploaded file exceeds 5 MB limit",
      requestId,
    );
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return envelopeResponse(400, "bad_request", "invalid multipart body", requestId);
  }

  const form = new FormData();
  for (const [key, value] of incoming.entries()) {
    if (value instanceof Blob && value.size > MAX_INGEST_BYTES) {
      return envelopeResponse(
        413,
        "payload_too_large",
        "uploaded file exceeds 5 MB limit",
        requestId,
      );
    }
    form.append(key, value as Blob | string);
  }

  return proxyUpstream(
    request,
    "/ingest",
    { method: "POST", body: form },
    { rateLimitKey: "ingest" },
  );
}
