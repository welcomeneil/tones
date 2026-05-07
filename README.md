# tone zone

A value-study reference tool for painters and illustrators. Drop in a photo,
pick how many tonal zones you want, and the image is posterized into a flat
grayscale palette — the same exercise art schools call a *value study*, done
in the browser in real time.

**Live:** [tone-zone on Vercel](https://github.com/welcomeneil/tones) — see the
"view source" footer of the deployed app for the canonical URL.

---

## What it does

A photographic reference holds far more value information than a human eye
can usefully read. *tone zone* collapses an image to a small set of discrete
grayscale "zones" — the same idea as Ansel Adams' Zone System or a painter's
value-block-in pass — and lets you:

- **Pick the value count yourself** (`targeted` mode) — k-means clustering on
  the image's grayscale histogram finds the *N* most representative tones.
- **Let the image pick its own** (`auto` mode) — Gaussian-smoothed histogram
  peaks segment the image at its natural tonal valleys; a slider tunes how
  much the histogram is smoothed (low σ → many fine zones, high σ → a few
  broad ones).
- **Hover or click any zone** to see its bounding-box brackets overlaid on
  the image and read its Munsell value (0 = black, 10 = white).
- **Toggle** between the posterized zone map and the original reference
  while keeping zone selection synced.

Every parameter change re-renders in well under a frame. There's no upload,
no server round-trip, no spinner — the entire pipeline runs in a Web Worker
on the user's machine.

---

## How it works

```
File ──► downscale to 1200px ──► OffscreenCanvas ──► ImageBitmap
                                                         │
                                                         ▼
                                                ┌──── Web Worker ────┐
                                                │  bitmapToGrayscale │   (Rec. 601 luma)
                                                │   computeHistogram │   (256 bins)
                                                │         │          │
                                                │         ▼          │
                                                │   runKmeans1D  ◄──┐│
                                                │     OR runPeaks ─┐│ │
                                                │         │        │ │
                                                │         ▼        │ │
                                                │   digitize       │ │
                                                │   paletteFromZones│ │
                                                │   paintZoneMap   │ │
                                                │   buildZoneIndex │ │
                                                └─────────│────────┘ │
                                                          ▼          │
                                                  postMessage with   │
                                                ImageBitmap +        │
                                                ImageData (zero-copy)│
                                                          │          │
                                                          ▼          │
                                                     React renders   │
                                                          │          │
                                                          └──────────┘
                                                       (param change re-runs
                                                        only the highlighted
                                                        path — image stays cached)
```

The key insight: every algorithm here is a function of the **value
distribution**, not the spatial layout. Once the 256-bin histogram is built,
the math is image-size-independent — k-means runs in microseconds whether
the photo is 400×400 or 1200×1200. Decode-once, re-segment-cheaply.

---

## The algorithms

Both are ports of the original Python pipeline (numpy + scipy) to TypeScript,
preserving algorithmic behavior closely enough that output is visually
indistinguishable.

### 1-D weighted k-means (`targeted` mode)
- k-means++ initialization weighted by histogram counts.
- Lloyd iteration over the 256-bin value space, weights = counts.
- Boundaries placed at midpoints between adjacent centers.
- Mulberry32 RNG (deterministic, 32-bit state) — same algorithm as the
  Python pipeline's PCG64, but seeded outputs differ by ±1–2 grayscale levels.

### Histogram peaks (`auto` mode)
- `gaussian_filter1d` with scipy defaults (`mode='reflect'`, `truncate=4`),
  rebuilt reflection arithmetic and all.
- `find_peaks` on the negated smoothed histogram — local minima become zone
  boundaries — including scipy's plateau-midpoint behavior.

Source: `frontend/app/lib/algorithms/{kmeans1d,peaks,shared}.ts`.

The reference Python (kept in `original_code.py` as a sketch, plus the
fuller pipeline that lived under `api/` before the teardown) used PIL,
numpy, and scipy. The TypeScript port matches PIL's "L" mode luma
coefficients (`R·0.299 + G·0.587 + B·0.114`) so grayscale is identical.

---

## Stack

| Layer            | Choice                                              |
|------------------|-----------------------------------------------------|
| Framework        | Next.js 16 (App Router) with Turbopack             |
| UI               | React 19, Tailwind CSS v4                           |
| Compute          | Dedicated Web Worker, `OffscreenCanvas`, `ImageBitmap` |
| Hosting          | Vercel (static + serverless — but no functions used) |
| Analytics        | `@vercel/analytics`                                 |
| Type-checking/CI | `tsc --noEmit` + ESLint on push and PR              |

Zero runtime dependencies on a server. The repo previously shipped a
FastAPI service on Fly.io (Docker, `pipeline.py`, two-phase
ingest/analyze API with binary PNG endpoints, in-memory grayscale cache);
that's gone — see the project log below for why.

---

## Repo layout

```
tone_zone/
├── frontend/
│   ├── app/
│   │   ├── page.tsx                  # client component owning the lifecycle
│   │   ├── layout.tsx, globals.css
│   │   ├── components/
│   │   │   ├── DropZone.tsx
│   │   │   ├── AnalyzedCanvas.tsx    # zone overlay + bracket rendering
│   │   │   ├── PaletteStrip.tsx
│   │   │   ├── AlgoToggle.tsx
│   │   │   ├── ModeToggle.tsx
│   │   │   ├── ValueCountPicker.tsx
│   │   │   └── SigmaSlider.tsx
│   │   └── lib/
│   │       ├── algorithms/           # k-means, peaks, shared primitives
│   │       ├── worker/               # process.worker.ts + typed client
│   │       ├── api.ts                # worker-backed analyzer
│   │       ├── downscale.ts
│   │       └── types.ts
│   ├── next.config.ts
│   └── package.json
├── original_code.py                  # the original notebook-style sketch
├── LEARN.md                          # decision log + concept queue
└── .github/workflows/test.yml        # tsc + lint on push and PR
```

---

## Local development

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npm run lint
npx tsc --noEmit   # what CI runs
```

Drop an image, pick a mode, drag a slider. That's the whole loop.

No environment variables. No database. No backend service to start.

---

## Engineering log highlights

A more detailed decision log lives in [`LEARN.md`](./LEARN.md). The arc:

- **Started** as a notebook-style script (`original_code.py`) — proving you
  can implement value posterization without copilot help.
- **First production cut** was a two-service deploy: Next.js on Vercel for
  the UI, FastAPI on Fly.io for the pipeline, talking through a same-origin
  Vercel Route Handler that hid the Fly URL and injected a shared internal
  token. Worked fine; was slow.
- **Optimization pass** introduced an `ingest` → `analyze` split with an
  in-memory grayscale cache keyed by upload id, binary PNG endpoints with
  `Cache-Control: immutable` + `?v=` cache-busting, and a switch from PIL
  `optimize=True` to `compress_level=1`. Param changes dropped from
  ~600ms warm / 2–10s cold to ~25ms.
- **Then deleted the entire backend.** Once the pipeline was operating on
  a 256-bin histogram instead of the pixel buffer, "do the math on the
  client" became trivially cheap. The current architecture is one Web
  Worker holding the grayscale buffer for the lifetime of the page,
  re-segmenting in microseconds. Cold-start latency, Fly free-tier compute
  budget, the Dockerfile, the proxy routes, and the `ANALYZER_URL` env
  var all went with it.

The lesson kept on the wall: **a backend isn't free even when idle**. Cold
starts, observability surface, deploy pipeline, dependency upgrades, all
cost something. Sometimes the highest-leverage performance work is
deleting the service.

---

## Tradeoffs worth naming

- **Client CPU instead of server CPU.** Fine for 1200×1200 images and
  256-bin k-means; it would matter the moment a feature wanted ML weights
  or operated on the raw pixel grid.
- **Visual parity, not byte-exact.** Different RNG (Mulberry32 vs PCG64)
  means seeded centers can land 1–2 grayscale levels off the Python
  pipeline. For a value-study reference aimed at human eyes this is
  invisible.
- **Abort isn't real cancellation.** A worker can't interrupt a synchronous
  k-means loop mid-flight; the client just discards the result. Cheap at
  this scale; would need chunking + a `SharedArrayBuffer` flag if the math
  got heavier.

---

## Credits

Built by [Neil Bisht](https://github.com/welcomeneil). The reference
inspiration is [tonalvaluetool.com](https://tonalvaluetool.com), which
showed that this whole exercise belongs in the browser.
