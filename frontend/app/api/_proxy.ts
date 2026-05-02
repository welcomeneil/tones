// Shared upstream-proxy helper. Guarantees every response that leaves the
// proxy is either (a) a successful upstream body passed through, or (b) a
// JSON error envelope { error: { code, message } }. Never forwards HTML/text
// error pages from the upstream edge.
//
// Also enforces:
//   - upstream timeout (a hung Fly machine cannot stall the Vercel function)
//   - x-request-id propagation so Vercel and Fly logs can be correlated
//   - x-internal-token forwarding so Fly can reject direct public traffic
//   - optional per-IP rate limiting at the choke point

import { rateLimit } from "./_ratelimit";

const ANALYZER_URL = process.env.ANALYZER_URL ?? "http://127.0.0.1:8080";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;
const UPSTREAM_TIMEOUT_MS = 25_000;

export const MAX_INGEST_BYTES = 5 * 1024 * 1024; // mirrors api/main.py
export const MAX_JSON_BYTES = 8 * 1024;

export function envelopeResponse(
  status: number,
  code: string,
  message: string,
  requestId?: string,
): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (requestId) headers["x-request-id"] = requestId;
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers });
}

export function getOrCreateRequestId(request: Request): string {
  const incoming = request.headers.get("x-request-id");
  if (incoming && /^[A-Za-z0-9._-]{1,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID().replace(/-/g, "");
}

export function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export type ProxyOptions = {
  rateLimitKey?: "ingest" | "analyze" | "zone";
};

export async function proxyUpstream(
  request: Request,
  path: string,
  init: RequestInit,
  options: ProxyOptions = {},
): Promise<Response> {
  const requestId = getOrCreateRequestId(request);

  if (options.rateLimitKey) {
    const ip = getClientIp(request);
    const decision = await rateLimit(ip, options.rateLimitKey);
    if (!decision.allowed) {
      return envelopeResponse(
        429,
        "rate_limited",
        "too many requests; please slow down",
        requestId,
      );
    }
  }

  const headers = new Headers(init.headers);
  headers.set("x-request-id", requestId);
  if (INTERNAL_TOKEN) headers.set("x-internal-token", INTERNAL_TOKEN);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  const startedAt = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(`${ANALYZER_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof DOMException && err.name === "AbortError";
    console.error(
      JSON.stringify({
        event: "proxy_upstream_error",
        rid: requestId,
        path,
        aborted,
        ms: Date.now() - startedAt,
      }),
    );
    return envelopeResponse(
      aborted ? 504 : 503,
      aborted ? "upstream_timeout" : "upstream_unavailable",
      aborted
        ? "the analysis service did not respond in time; please try again"
        : "the analysis service is unreachable; please try again",
      requestId,
    );
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    console.warn(
      JSON.stringify({
        event: "proxy_upstream_non_ok",
        rid: requestId,
        path,
        status: upstream.status,
        ms: Date.now() - startedAt,
      }),
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  if (upstream.ok) {
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": contentType || "application/octet-stream",
        "cache-control": upstream.headers.get("cache-control") ?? "no-store",
        "x-request-id": requestId,
      },
    });
  }

  if (!contentType.includes("application/json")) {
    return envelopeResponse(
      502,
      "upstream_invalid",
      "the analysis service returned an unexpected response",
      requestId,
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}
