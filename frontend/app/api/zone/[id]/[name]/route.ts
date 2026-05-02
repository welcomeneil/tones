import { envelopeResponse, getOrCreateRequestId, proxyUpstream } from "../../../_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ID_RE = /^[a-f0-9]{16,64}$/;
const NAME_RE = /^(map|index)\.png$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const requestId = getOrCreateRequestId(request);

  if (!ID_RE.test(id) || !NAME_RE.test(name)) {
    return envelopeResponse(404, "not_found", "unknown zone asset", requestId);
  }

  const url = new URL(request.url);
  const search = /^\?v=\d+$/.test(url.search) ? url.search : "";

  return proxyUpstream(
    request,
    `/zone/${id}/${name}${search}`,
    { method: "GET" },
    { rateLimitKey: "zone" },
  );
}
