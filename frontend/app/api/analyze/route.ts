import {
  MAX_JSON_BYTES,
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
  if (declared && Number(declared) > MAX_JSON_BYTES) {
    return envelopeResponse(413, "payload_too_large", "request body too large", requestId);
  }

  const body = await request.text();
  if (body.length > MAX_JSON_BYTES) {
    return envelopeResponse(413, "payload_too_large", "request body too large", requestId);
  }

  return proxyUpstream(
    request,
    "/analyze",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    },
    { rateLimitKey: "analyze" },
  );
}
