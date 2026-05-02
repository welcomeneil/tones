import { proxyUpstream } from "../_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const incoming = await request.formData();
  const form = new FormData();
  for (const [key, value] of incoming.entries()) {
    form.append(key, value as Blob | string);
  }
  return proxyUpstream("/ingest", { method: "POST", body: form });
}
