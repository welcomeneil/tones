// Shared upstream-proxy helper. Guarantees every response that leaves the
// proxy is either (a) a successful upstream JSON body passed through, or
// (b) a JSON error envelope { error: { code, message } }. The proxy never
// forwards HTML/plaintext error pages from the upstream edge.

const ANALYZER_URL = process.env.ANALYZER_URL ?? "http://127.0.0.1:8080";

function envelopeResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export async function proxyUpstream(
  path: string,
  init: RequestInit,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(`${ANALYZER_URL}${path}`, init);
  } catch {
    return envelopeResponse(
      503,
      "upstream_unavailable",
      "the analysis service is unreachable; please try again",
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  // Successful binary/JSON responses pass through untouched.
  if (upstream.ok) {
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": contentType || "application/octet-stream",
        "cache-control": upstream.headers.get("cache-control") ?? "no-store",
      },
    });
  }

  // Error responses must be JSON envelopes. If upstream sent HTML/text
  // (e.g. Fly edge serving a 5xx page), wrap it.
  if (!contentType.includes("application/json")) {
    return envelopeResponse(
      502,
      "upstream_invalid",
      "the analysis service returned an unexpected response",
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
