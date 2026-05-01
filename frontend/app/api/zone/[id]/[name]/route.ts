export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANALYZER_URL = process.env.ANALYZER_URL ?? "http://127.0.0.1:8080";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const url = new URL(request.url);

  const upstream = await fetch(`${ANALYZER_URL}/zone/${id}/${name}${url.search}`);
  const buf = await upstream.arrayBuffer();
  return new Response(buf, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/png",
      "cache-control": upstream.headers.get("cache-control") ?? "no-store",
    },
  });
}
