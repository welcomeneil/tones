export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANALYZER_URL = process.env.ANALYZER_URL ?? "http://127.0.0.1:8080";

export async function POST(request: Request) {
  const incoming = await request.formData();
  const form = new FormData();
  for (const [key, value] of incoming.entries()) {
    form.append(key, value as Blob | string);
  }

  const upstream = await fetch(`${ANALYZER_URL}/analyze`, {
    method: "POST",
    body: form,
  });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
