import { proxyUpstream } from "../_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  return proxyUpstream("/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}
