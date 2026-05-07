# things to revisit (deployment + web fundamentals)

A running list of topics that came up while shipping this. Add to it freely.

## 1. proxies

- What is a proxy server, in general?
- Why is `frontend/app/api/analyze/route.ts` called a "same-origin proxy"?
- What does it hide / what does it enable (security, env-var secrecy, room for rate limits / auth / logging)?
- What's the difference between a *forward* proxy (corp network) and a *reverse* proxy (what we built)?

## 2. the request lifecycle: browser → Vercel function → Fly machine → response

- What actually happens at each hop when a user clicks "analyze"?
  - browser → Vercel edge (CDN / function dispatcher)
  - Vercel function (Node.js Route Handler) re-issues the request to Fly
  - Fly's load balancer → the Docker container running uvicorn → FastAPI handler → pipeline.py
  - response unwinds back through the same hops
- Why is this "same-origin" from the browser's perspective even though the work runs on two different providers?
- What's a TCP connection, a TLS handshake, an HTTP request — at each hop?

## 3. how is this app reasonably fast?

- Where does latency come from? (network round-trips, cold starts, image processing time, JSON serialization)
- Specific tricks already baked in:
  - Client-side downscale to 1200px **before** uploading (smaller body = faster upload)
  - Indexed PNG zone map (base64) instead of huge JSON int arrays (~100× smaller payload)
  - 400ms debounce on the analyze effect (don't fire while user is dragging the slider)
  - AbortController cancels stale in-flight requests
- What else could speed it up? (HTTP/2, edge caching of static assets, regional Fly machines, WebAssembly client-side pipeline)

## 4. containers (Docker, and what Fly actually runs)

- What is a container vs a VM vs a process?
- Read `Dockerfile` line by line — what does each instruction do?
- Why does the project ship a Dockerfile when Vercel doesn't need one?
- What is an image? A registry? A layer? Why are layers cached?
- Why was Fly chosen over Vercel Python Functions for the backend? (250 MB bundle limit, future ML deps like torch/sklearn/mediapipe)

## 5. rate limiting

- What is a rate limit, conceptually?
- Common algorithms: token bucket, leaky bucket, fixed window, sliding window
- Where do you put the limiter in our stack? (Vercel function = best spot — it's the choke point before Fly)
- What does "anyone could spam /api/analyze and blow your Fly free quota" actually mean?
  - Each analyze request boots/keeps a Fly machine running, consuming compute-seconds.
  - Fly free tier has finite compute-seconds per month; sustained abuse → 503s or charges.
  - Our partial mitigation: the client downscales to 1200px, so each request is bounded in CPU cost.
- How would we add rate limiting later? (Upstash Redis on Vercel, IP-based bucket, simple in-memory if single instance)

## 6. deployment in general (how the whole thing was deployed)

- The repo has two distinct services: one Next.js app (`frontend/`), one FastAPI backend (`api/` + `pipeline.py` at repo root).
- Backend deploy path: write `fly.toml` → `fly apps create` → `fly deploy` builds remote Docker image, ships to Fly registry, boots VMs in IAD region.
- Frontend deploy path: `vercel link` → `vercel env add ANALYZER_URL` → `vercel deploy --prod` builds the Next app on Vercel's builders, deploys static assets to their CDN + serverless function for the route handler.
- What makes them talk to each other? The `ANALYZER_URL` env var Vercel injects at runtime into the Node.js function.
- Why is the Fly URL never exposed to the browser? (Vercel function reads it, browser only ever sees the Vercel domain.)

## 7. environment variable visibility

- What does it mean for an env var to be "public" vs "private"?
- Why is `ANALYZER_URL` (no `NEXT_PUBLIC_` prefix) only visible to the server, not the browser?
- If I named it `NEXT_PUBLIC_ANALYZER_URL`, what would change — and why would that be a regression for our setup?
- Where do env vars actually live at runtime?
  - On Vercel: stored encrypted, injected into the function's process env at cold start.
  - On Fly: stored as Fly secrets / config, mounted into the container's env.
  - Locally: `.env.local` in the frontend dir, loaded by Next at dev time.
- Build-time vs runtime env vars — what's the difference, and which kind is `ANALYZER_URL`?

## 8. cold starts

- What is a cold start, in plain terms?
- Why does our `auto_stop_machines = "stop"` + `min_machines_running = 0` config cause them?
- What's the tradeoff: cost (free when idle) vs latency (1–3s on first request)?
- How would we eliminate cold starts? (`min_machines_running = 1`, but you pay 24/7)
- Is the Vercel function side also subject to cold starts? When does that bite?
- What's a "warmup" strategy — pinging health endpoints on a schedule to keep machines alive?

## 9. observability

- The three classic pillars: **logs**, **metrics**, **traces**. What does each tell you?
- Where would each live in this stack?
  - Logs: Fly's log stream, Vercel's function logs.
  - Metrics: Fly's dashboard (CPU, memory, request rate), Vercel Analytics.
  - Traces: not set up — would require something like OpenTelemetry across both services.
- What's an "error budget" / "SLO"? Useful even for a hobby project?
- How would I get notified if `tone-zone-api.fly.dev` started 500'ing? (uptime monitoring services, Fly alerts)
- For a portfolio piece, what's the minimum viable observability worth adding?

## 10. browser ↔ server separation (host/client relationship)

The mental model that ties everything else together.

- What runs **in the browser** (the "client") vs **on a server**?
  - Client: every `.tsx` component renders to HTML/JS that the browser executes. The user's CPU, RAM, network.
  - Server: anything in `app/api/` route handlers, plus the Fly container. Code the user never sees, machines they don't own.
- Why is this separation enforced? (Security: secrets, DB credentials, paid APIs must stay server-side. Performance: heavy compute belongs on a fat server, not a phone.)
- React Server Components / Client Components — which is which? What does `"use client"` at the top of `page.tsx` actually do?
- The full lifecycle of one analyze click:
  1. User clicks "analyze" in their browser → a function in our React code (client) fires.
  2. That function calls `fetch("/api/analyze", ...)` → request leaves the browser, hits Vercel's edge.
  3. Vercel routes to our serverless function (a brief Node.js process spun up just for this request).
  4. The function reads `ANALYZER_URL` and calls Fly: `fetch("https://tone-zone-api.fly.dev/analyze", ...)`.
  5. Fly's load balancer forwards to the Docker container; uvicorn picks it up; FastAPI hands the bytes to `pipeline.py`.
  6. pipeline.py runs numpy/scipy on the image; returns zones, palette, boundaries.
  7. FastAPI serializes to JSON; Fly sends it back to the Vercel function.
  8. Vercel function passes the JSON back to the browser; React state updates; canvas re-renders.
- What does the user's machine never see? (the Fly URL, any pipeline.py code, the env vars)
- Why is "the host" not a single thing here? (host = whoever runs the code at each layer: Vercel hosts the Next app + function, Fly hosts the Python container)
- How does this scale? If 1000 people use the app at once, what happens at each tier? Where does it break first?

## 11. (open) other topics worth queuing

- DNS, CNAMEs, custom domains
- HTTPS / TLS certs (Fly and Vercel both auto-provision them — how?)
- Edge vs regional vs serverless — how Vercel routes a request differently for static assets, route handlers, etc.

---

# Decision log

Chronological record of significant questions investigated and tradeoffs made. Each entry: the question, what we did, what we gave up, concepts to revisit.

## 2026-04-30 — Mobile responsiveness for footer + sticky palette nav

**Question.** Footer text and the sticky palette nav looked cramped on mobile (≤375px). How to fix without regressing desktop?

**What we did** (`frontend/app/page.tsx`):
- Footer: replaced single inline string with discrete `<span>` segments inside a `flex flex-wrap items-center gap-x-2 gap-y-1` container. Now wraps at bullet boundaries instead of mid-phrase.
- Sticky nav row: changed wrapper to `flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6` so `ModeToggle` and the value readout stack on phones.
- "locked" hint pill: hidden below `sm` (`hidden sm:inline`). With tap-to-lock UX the lock state is implicit; the pill was redundant on a small viewport.

**Tradeoff.** Mobile loses a vertical row of header height (sticky bar grows) and the explicit "locked" affordance. We bet that the visual lock cue on the palette swatch itself is enough. Alternatives considered: shorten `Vn/N · value X.X` to just `X.X` on mobile (rejected — felt like hiding signal, not noise).

**Concepts to revisit.** Tailwind responsive prefixes (`sm:` etc.) and the mobile-first model; flexbox wrapping vs CSS grid for footer-style segment layouts; when to hide UI hints vs when they're load-bearing.

## 2026-04-30 — Why analyze feels slow, especially on `n` changes

**Question.** Image analysis is slow on upload and on every value-count change. What's the pipeline and where's the time going?

**Pipeline traced.**
1. Browser: `downscaleImage` (`frontend/app/lib/downscale.ts`) — decode → OffscreenCanvas at 1200px max edge → JPEG q=0.85 → re-decode. Once per upload.
2. Browser: `analyze()` (`frontend/app/lib/api.ts:14`) builds FormData and POSTs `/api/analyze`. Re-fires every time `blob | algo | n | sigma` changes (`page.tsx:61-89`), debounced 400ms.
3. Vercel function: `frontend/app/api/analyze/route.ts` — reads FormData, rebuilds it field-by-field, fetches `${ANALYZER_URL}/analyze`. Adds a hop and double-buffers bytes.
4. FastAPI/Python (`api/main.py:28` → `pipeline.py` → `api/algorithms/*`): `await file.read()` → `load_grayscale` (PIL decode) → algorithm on the 256-bin histogram (cheap, sub-ms).
5. `api/serialize.py`: two PNG encodes with `optimize=True`, then base64 into JSON in `main.py:59-60`.

**Where the time actually goes.** Algorithm itself is trivial. Real costs: re-uploading the full JPEG on every `n` tick, possible Fly cold start (`auto_stop_machines = "stop"`, `min_machines_running = 0`), `PIL PNG optimize=True` × 2 on a 1200×1200 array, base64 inflating the response ~33% + extra JSON parse client-side.

**What we'd do (not yet implemented).** Highest-leverage fix: cache decoded grayscale on the server keyed by an upload ID. Upload returns `{id, w, h}`; subsequent `n`/`sigma` changes POST `{id, algo, n, sigma}` and skip upload + decode. Secondary wins: drop `optimize=True` (or `compress_level=1`), return PNGs as binary not base64, longer debounce on `n`/`sigma`-only changes, keep one Fly machine warm.

**Tradeoff to think about.** Server-side caching introduces state — eviction policy, memory pressure, multi-machine consistency on Fly if we ever scale out. Single-machine LRU is fine for portfolio scale; pretending it'll scale further is premature.

**Concepts to revisit.** The economics of "upload once, parameterize many times" as a general API design pattern; PNG compression strategies (`optimize` vs `compress_level`); base64-in-JSON vs binary responses (`Content-Type: image/png` + separate metadata endpoint, or multipart); React `useEffect` dependency-array as the de facto trigger for network work and how to split "ingest" from "recompute" effects; Fly auto-stop economics (free idle vs cold-start latency).

## 2026-04-30 — Implemented the four high-leverage analyze fixes

**What we did.**

1. **Server-side grayscale cache.** New `api/cache.py` — in-memory `dict[id → {gray, map_png, index_png, version, ts}]` with a `threading.Lock`, 10min TTL, 32-entry cap. Added `POST /ingest` (`api/main.py`) which decodes once and returns `{id, width, height}`. `POST /analyze` is now JSON `{id, algo, n, sigma}` and looks up the cached gray instead of re-decoding bytes. `pipeline.py` split into `decode()` + `segment()` so callers can reuse cached arrays.
2. **Binary PNGs, not base64 JSON.** New `GET /zone/{id}/{map|index}.png` returns raw bytes with `Cache-Control: public, max-age=3600, immutable`. `/analyze` returns `mapUrl`/`indexUrl` ending in `?v={version}` for browser-cache busting on each re-analyze. Same-origin proxied at `frontend/app/api/zone/[id]/[name]/route.ts`.
3. **`compress_level=1`** in `api/serialize.py` instead of `optimize=True`. Same correctness, multi-x faster encode.
4. **Debounce 250 → 400ms**, but only on the analyze effect. Ingest got its own effect with no debounce; the slider/picker debounce only governs param-change cycles.

**Frontend wiring** (`frontend/app/page.tsx`, `lib/api.ts`, `components/AnalyzedCanvas.tsx`):
- Two effects: `[blob, imageId]` runs ingest when blob is set and id is null; `[imageId, algo, n, sigma]` runs analyze on a 400ms timer.
- 404 on analyze (cache evicted between calls — TTL or machine restart) clears `imageId` and the ingest effect re-fires automatically. No user-visible failure.
- `AnalyzedCanvas` swapped `base64ToBlob(...)` for `fetch(url).then(r => r.blob())` with an `AbortController`. Browser handles PNG decode natively; no string→bytes shim.

**Measured.** On a 400×400 test image, an `n` change is ~25ms end-to-end through the Next.js proxy. Previously every tick re-uploaded, re-decoded, and ran two `optimize=True` PNG encodes.

**Tradeoff: server now has state.** Single-process, in-memory cache is fine on one Fly machine but doesn't survive restarts and won't share across replicas if we ever scale out. Eviction is naive (TTL + max-size, no LRU on access pattern). Defended by:
- Explicit 404 contract → frontend re-ingests transparently.
- Soft caps (32 entries × ~MB each) keep memory bounded.
- Portfolio-scale: a real prod system would push this to Redis or similar; flagged but not built.

**API protocol broke.** `/analyze` no longer accepts FormData. Anything that talked to the old API would fail. Fine for now (no public consumers); on a real product this would need a versioned route.

**Concepts to revisit.** Two-phase API design (ingest/process split) and how it composes with idempotency, retries, and resumable uploads; cache eviction policies (TTL vs LRU vs LFU vs ARC); HTTP cache semantics (`Cache-Control: immutable`, query-param cache busting, ETags); Pydantic v2 `BaseModel` for request validation; Next.js dynamic route handlers with `Promise<{params}>` (changed in 15+); the difference between *backpressure* (server says slow down) and *debounce* (client throttles itself before sending).

## 2026-05-01 — What's a browser cache, and where could it help us?

**Q.** What is a browser cache? Could it speed up the app?

**Answer in one paragraph.** The browser keeps a local URL-keyed store of HTTP responses; cacheable responses skip the network entirely. The server controls cacheability via `Cache-Control` and `ETag` headers.

**Where it already helps us.** PNG endpoint returns `Cache-Control: public, max-age=3600, immutable` with `?v={version}` for cache-busting on re-analyze (same trick as Next.js's hashed bundle filenames). Static assets (JS/CSS/fonts) get this for free from Next.js.

**Where it doesn't and why.** Re-selecting an already-seen `n` value still re-runs the server pipeline and bumps `?v`, so the PNG cache miss happens even though the bytes would be identical. To harvest that, either: (a) server caches result PNGs keyed by `(id, algo, n, sigma)` for stable URLs, or (b) client memoizes `AnalyzeResult` in a `Map`. Decided: not worth implementing now — the param space is small but unbounded enough that the win is marginal.

**Concepts to revisit.** `Cache-Control` directives (`public`, `private`, `no-store`, `no-cache`, `immutable`, `s-maxage`); ETag / 304 revalidation flow; cache-busting via filename hash vs query string; CDN edge caches vs browser cache vs server cache (where each lives, what each invalidates).

## 2026-05-06 — Moved the entire image pipeline to the browser

**Q.** A reference site (tonalvaluetool.com) does the same kind of tonal posterization and feels instant. Ours has a noticeable lag on every action. Why, and can we close the gap?

**Diagnosis.** Their tool runs *entirely* in the browser via `<canvas>` + a pixel-loop. Ours did three round-trips per analyze: `POST /api/ingest` (Vercel proxy → Fly), `POST /api/analyze` (same path, returns two PNG URLs), then `GET` on each PNG (same path again). On a warm machine that's ~600ms minimum; on a cold Fly machine it's 2–10s. The k-means math itself was sub-millisecond — every other ms was network plus PNG re-encode. Operating on a 256-bin histogram (not millions of pixels) means moving the math to the browser is trivially cheap.

**What we did** (new branch `client-side-port`, off `main`, prod untouched):

1. **Ported the algorithms to TypeScript.**
   - `frontend/app/lib/algorithms/shared.ts` — 256-bin histogram, `digitize` (binary-search port of `np.digitize`), palette mean per zone, painters for the zone-map ImageBitmap and zone-index ImageData. PIL's "L"-mode coefficients (Rec. 601 luma) used to keep grayscale parity with the Python pipeline.
   - `frontend/app/lib/algorithms/kmeans1d.ts` — weighted k-means++ init + Lloyd iteration over the histogram. Works on the 0..255 value space with histogram counts as weights, so cost is *image-size-independent* once the histogram exists. Mulberry32 RNG (deterministic, 32-bit state).
   - `frontend/app/lib/algorithms/peaks.ts` — `gaussian_filter1d` with scipy defaults (`mode='reflect'`, `truncate=4`) and `find_peaks` with plateau-midpoint behavior, used to find local minima of the smoothed histogram.

2. **Web Worker owns the image, not the main thread.**
   - `frontend/app/lib/worker/process.worker.ts` keeps the grayscale buffer and histogram for the current image cached for the lifetime of the page. Three message types: `load` (decode blob → cache gray + histogram), `analyze` (run algo, paint zone-map + zone-index, transfer back), `reset` (clear cache on file replace).
   - `frontend/app/lib/worker/client.ts` is a typed `Promise`-based wrapper around `postMessage`/`onmessage`. Tracks pending requests by id, supports `AbortSignal`, and closes any `ImageBitmap` from a late response that arrives after the caller aborted (otherwise the GPU memory leaks).

3. **Page collapsed two effects into two — but the second is now ~free.** `page.tsx` previously had `[blob, imageId]` (ingest) and `[imageId, algo, n, sigma]` (analyze) effects. Now it has `[blob, imageLoaded]` (worker.load) and `[imageLoaded, algo, n, sigma]` (worker.analyze). The 400ms debounce stays. The `ApiError("image_not_found") → re-ingest` recovery path went away because there's no remote cache to evict from anymore.

4. **No PNGs on the wire — no PNGs at all.** The worker paints `zoneMap` straight to an `OffscreenCanvas` and returns it as `ImageBitmap` (via `transferToImageBitmap()`). The zone-index is built directly as `ImageData` with `R = G = B = zoneIndex`. Both are transferred zero-copy back to the main thread. No PNG encode, no PNG decode, no base64.

5. **Backend service is now dead code on this branch.** `frontend/app/api/ingest`, `/analyze`, `/zone/[id]/[name]` route handlers, the whole `api/` Python package, and `pipeline.py` are all unused. Left in the tree on this branch so the port can be A/B'd against the Python output before deletion.

**Performance gain.** A param change (e.g. `n` 5→7) used to be: 400ms debounce + ~600ms network + PNG decode. Now it's 400ms debounce + worker round-trip with histogram-only k-means. On a 1200×1200 grayscale buffer the histogram already exists, so the analyze step is *sub-millisecond*; the round-trip itself is the floor. Cold Fly start (2–10s on first action) is gone entirely.

**Tradeoff: client CPU instead of server CPU.** Every user pays the cost on their own device. For 1200px images doing 256-bin k-means this is invisible; for hypothetical future features (semantic segmentation, ML-based zone proposals) we'd be pushing tens of MB of model weights to the browser and the math would matter. Plan: keep the client-only architecture as long as the algorithms stay histogram-shaped; reach for WebAssembly + worker only if we ever want heavier ops without a server hop; consider re-adding a server *only* if a feature genuinely needs one (private model, expensive compute, server-side caching of cross-user state).

**Tradeoff: parity with Python is visual, not byte-exact.** Two reasons:
- k-means uses a seeded RNG. NumPy's PCG64 won't byte-match a JS port; we use Mulberry32. Same algorithm, same convergence, but seeded centers can land 1–2 grayscale levels off from the Python pipeline.
- `gaussian_filter1d` we matched scipy defaults (`mode='reflect'`, `truncate=4`) carefully, so smoothed-histogram values match closely; rare edge cases on very flat histograms could shift a peak index by 1 bin.

For a value-study reference tool aimed at human artists this is invisible. If we ever want strict regression-testing against the Python pipeline, the unit tests at `tests/test_algorithms.py` are the source of truth — we'd need a parallel TS test suite seeded with the same fixtures.

**Tradeoff: AbortSignal but no real cancellation.** A worker can't actually interrupt a sync k-means loop in the middle. Our abort just ignores the response when it arrives; the worker still runs the computation to completion. For 256-bin k-means that's fine (microseconds); if the math ever grew, we'd need to chunk the work and check a shared SharedArrayBuffer flag, or terminate-and-replace the worker on cancel.

**What we did *not* do.**
- Did not port to WebAssembly. Pure JS is fast enough and trivially debuggable; WASM is the wrong reach right now.
- Did not delete the Fly backend or the Vercel proxy routes yet. Want to A/B against the Python output on a Vercel preview URL before pulling the rug. Once validated: delete the Python code, delete the proxy routes, stop the Fly machine, remove `ANALYZER_URL` from Vercel env. The Dockerfile and `fly.toml` go too.
- Did not split the worker bundle from the main bundle manually — Next.js 16 + Turbopack handles `new Worker(new URL("./process.worker.ts", import.meta.url), { type: "module" })` automatically, producing a separate chunk.

**Concepts to revisit.**
- **Web Workers**: the dedicated-worker model, `postMessage` semantics, the `Transferable` interface (`ArrayBuffer`, `ImageBitmap`, `MessagePort`, `OffscreenCanvas`), and zero-copy transfer vs structured-clone copy.
- **`OffscreenCanvas`** as a worker primitive — when to draw in a worker vs ship pixel buffers back; `transferToImageBitmap()` semantics.
- **The "where does the math live" architectural axis**: client / edge function / regional function / managed container / GPU box. Each tier shifts cost, latency, security, and team boundaries; there's no universally right answer, only a fit per workload.
- **Determinism in numerical ports**: when does "same algorithm" suffice and when do you need bit-exact parity? Why do RNG choice, FP rounding modes, and library defaults all conspire to make exact parity expensive?
- **Histogram-shaped algorithms**: any operation that's a function of the value distribution, not the spatial layout, can be made image-size-independent. Recognize this shape (color quantization, levels adjustments, posterization, exposure histogram analysis) and the pipeline becomes "decode once → histogram once → re-run cheap math indefinitely."
- **The economics of removing a service**: a backend isn't free even when idle (cold-start risk, observability surface, deployment pipeline, dependency upgrades). Sometimes the highest-leverage performance work is *deleting* the service that was sitting in the critical path.
