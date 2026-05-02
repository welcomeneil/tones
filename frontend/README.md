# tone_zone — frontend

Next.js 16 (App Router) UI for the tonal-zone reference tool. Talks to the
FastAPI backend via same-origin route handlers under `app/api/*`.

## Layout

- `app/page.tsx` — the only page; client component owning the upload →
  ingest → analyze → render lifecycle.
- `app/components/` — DropZone, AnalyzedCanvas (zone overlay + bracket
  rendering), PaletteStrip, sliders/toggles.
- `app/lib/api.ts` — fetch wrapper that decodes the `{ error: { code,
  message } }` envelope into typed `ApiError`s.
- `app/lib/downscale.ts` — client-side downscale to 1200px before upload.
- `app/api/_proxy.ts` — shared proxy helper. Forwards to `ANALYZER_URL`,
  enforces upstream timeout, propagates `x-request-id`, sets
  `x-internal-token`, applies per-IP rate limits.
- `app/api/_ratelimit.ts` — in-memory per-route token bucket.
- `app/api/{ingest,analyze,zone/[id]/[name]}/route.ts` — three thin
  endpoints calling the proxy.

## Env vars

Copy `.env.local.example` → `.env.local`.

- `ANALYZER_URL` — FastAPI base URL. Server-only.
- `INTERNAL_TOKEN` (optional) — shared secret with the backend so the
  Fly URL rejects direct public traffic. Match Fly's `INTERNAL_TOKEN`.

## Dev

```bash
npm install
npm run dev          # http://localhost:3000
npm run lint
```

The backend must be running separately (`uvicorn api.main:app
--port 8080` from the repo root, or via Docker — see top-level docs).

## Deploy

`vercel deploy --prod`. Vercel reads `ANALYZER_URL` and `INTERNAL_TOKEN`
from the project's environment variables.
