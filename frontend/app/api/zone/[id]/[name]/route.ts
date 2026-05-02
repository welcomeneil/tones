import { proxyUpstream } from "../../../_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const url = new URL(request.url);
  return proxyUpstream(`/zone/${id}/${name}${url.search}`, { method: "GET" });
}
