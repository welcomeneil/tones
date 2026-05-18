"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalyzedCanvas } from "./components/AnalyzedCanvas";
import { DropZone } from "./components/DropZone";
import { HistoryStrip } from "./components/HistoryStrip";
import { ModeToggle } from "./components/ModeToggle";
import { PaletteStrip } from "./components/PaletteStrip";
import { ValueCountPicker } from "./components/ValueCountPicker";
import {
  type AnalyzedAssets,
  ProcessWorkerClient,
  toAnalyzedAssets,
} from "./lib/api";
import { downscaleImage } from "./lib/downscale";
import type { RenderMode } from "./lib/types";

const ANALYZE_DEBOUNCE_MS = 400;
const DEFAULT_N = 5;
// Cap session history at this many entries; oldest is evicted (bitmaps closed)
// when a new upload exceeds the cap. Posterized zone maps + downscaled bitmaps
// each hold ~MB-scale memory so we keep this small.
const HISTORY_CAP = 8;

type HistoryEntry = {
  id: string;
  file: File;
  blob: Blob | null;
  bitmap: ImageBitmap | null;
  analyzed: AnalyzedAssets | null;
  n: number;
  notan: boolean;
};

const NOTAN_N = 2;

export default function Home() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<RenderMode>("zones");
  const [hoveredZone, setHoveredZone] = useState<number | null>(null);
  const [lockedZone, setLockedZone] = useState<number | null>(null);
  // Zone indices present inside a user-drawn region box; null = whole image.
  const [regionZones, setRegionZones] = useState<number[] | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const workerRef = useRef<ProcessWorkerClient | null>(null);
  // Tracks which history entry's grayscale + histogram the worker currently
  // holds. Switching to a different cached entry doesn't reload the worker
  // unless the user actually changes n (its cached analyzed result is shown
  // immediately). Reset to null when the worker is reset.
  const workerLoadedIdRef = useRef<string | null>(null);
  const getWorker = () => {
    if (!workerRef.current) workerRef.current = new ProcessWorkerClient();
    return workerRef.current;
  };

  const current = useMemo(
    () => history.find((e) => e.id === currentId) ?? null,
    [history, currentId],
  );
  const result = current?.analyzed?.result ?? null;
  const selectedZone = hoveredZone ?? lockedZone;

  const patchEntry = useCallback(
    (id: string, patch: Partial<HistoryEntry>) => {
      setHistory((h) => h.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    },
    [],
  );

  // Latest-history ref so the unmount cleanup can close cached bitmaps without
  // re-running on every history change.
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // Downscale on file → produce blob + reference bitmap for the entry.
  // Runs once per entry (gated on !blob); switching back to an entry that
  // already has a blob is a no-op.
  useEffect(() => {
    if (!current || current.blob) return;
    const id = current.id;
    const file = current.file;
    let cancelled = false;
    downscaleImage(file)
      .then(({ blob, bitmap }) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        patchEntry(id, { blob, bitmap });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to process image");
      });
    return () => {
      cancelled = true;
    };
  }, [current, patchEntry]);

  // Combined worker load + analyze. Early-exits when the active entry already
  // has a cached analyzed result matching its desired n (the session-cache
  // payoff: instant restore on switch). Otherwise debounces, then loads the
  // worker for this entry if it hasn't been, and runs analyze.
  useEffect(() => {
    if (!current || !current.blob) return;
    const effectiveN = current.notan ? NOTAN_N : current.n;
    if (current.analyzed && current.analyzed.result.n === effectiveN) return;

    const id = current.id;
    const blob = current.blob;
    const n = effectiveN;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const timer = window.setTimeout(async () => {
      setInFlight(true);
      setError(null);
      try {
        if (workerLoadedIdRef.current !== id) {
          getWorker().reset();
          workerLoadedIdRef.current = null;
          await getWorker().load(blob, ctrl.signal);
          if (ctrl.signal.aborted) return;
          workerLoadedIdRef.current = id;
        }
        const msg = await getWorker().analyze(n, ctrl.signal);
        if (ctrl.signal.aborted) {
          msg.zoneMap.close();
          return;
        }
        const assets = toAnalyzedAssets(msg);
        setHistory((h) =>
          h.map((e) => {
            if (e.id !== id) return e;
            e.analyzed?.zoneMap.close();
            return { ...e, analyzed: assets };
          }),
        );
        setHoveredZone(null);
        setLockedZone(null);
        setRegionZones(null);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "analyze failed");
      } finally {
        if (abortRef.current === ctrl) {
          setInFlight(false);
          abortRef.current = null;
        }
      }
    }, ANALYZE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [current]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      workerRef.current?.terminate();
      workerRef.current = null;
      for (const e of historyRef.current) {
        e.bitmap?.close();
        e.analyzed?.zoneMap.close();
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLockedZone(null);
        setRegionZones(null);
        setError(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(t);
  }, [error]);

  const selectedLum =
    selectedZone !== null && result ? result.palette[selectedZone] ?? null : null;
  // sRGB hex for direct color-picking. Swatch paints R=G=B, so one byte repeated.
  const selectedHex =
    selectedLum !== null
      ? `#${selectedLum.toString(16).padStart(2, "0").repeat(3).toUpperCase()}`
      : null;
  const paletteSize = result?.palette.length ?? 0;
  // Dim the canvas + palette while a new palette is pending: the moment the
  // user changes n (palette length mismatch), through the debounce, until the
  // new analysis lands. Gives a "processing" cue without a spinner.
  const desiredN = current ? (current.notan ? NOTAN_N : current.n) : 0;
  const reanalyzing =
    result !== null && (inFlight || result.palette.length !== desiredN);

  const onUploadFile = (file: File) => {
    setError(null);
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const entry: HistoryEntry = {
      id,
      file,
      blob: null,
      bitmap: null,
      analyzed: null,
      n: DEFAULT_N,
      notan: false,
    };
    setHistory((h) => {
      const next = [entry, ...h];
      // Newest-first; evict the oldest tail entries past the cap.
      if (next.length > HISTORY_CAP) {
        for (const dropped of next.slice(HISTORY_CAP)) {
          dropped.bitmap?.close();
          dropped.analyzed?.zoneMap.close();
          if (workerLoadedIdRef.current === dropped.id) {
            workerLoadedIdRef.current = null;
          }
        }
        return next.slice(0, HISTORY_CAP);
      }
      return next;
    });
    setCurrentId(id);
    setHoveredZone(null);
    setLockedZone(null);
    setRegionZones(null);
  };

  const onReplace = () => {
    abortRef.current?.abort();
    setCurrentId(null);
    setHoveredZone(null);
    setLockedZone(null);
    setRegionZones(null);
    setError(null);
    setInFlight(false);
    setViewMode("zones");
  };

  const onSelectHistory = (id: string) => {
    if (id === currentId) return;
    abortRef.current?.abort();
    setCurrentId(id);
    setHoveredZone(null);
    setLockedZone(null);
    setRegionZones(null);
    setError(null);
  };

  const onRemoveHistory = (id: string) => {
    setHistory((h) => {
      const target = h.find((e) => e.id === id);
      if (!target) return h;
      target.bitmap?.close();
      target.analyzed?.zoneMap.close();
      if (workerLoadedIdRef.current === id) {
        workerLoadedIdRef.current = null;
      }
      return h.filter((e) => e.id !== id);
    });
    if (currentId === id) {
      abortRef.current?.abort();
      setCurrentId(null);
      setHoveredZone(null);
      setLockedZone(null);
      setRegionZones(null);
      setInFlight(false);
    }
  };

  const onChangeN = (newN: number) => {
    if (!current) return;
    patchEntry(current.id, { n: newN });
  };

  const onToggleNotan = () => {
    if (!current) return;
    patchEntry(current.id, { notan: !current.notan });
  };

  const thumbEntries = useMemo(
    () =>
      history.map((e) => ({
        id: e.id,
        filename: e.file.name,
        bitmap: e.bitmap,
      })),
    [history],
  );

  // Landing state (no image yet) clamps to the viewport so there's no scroll
  // on mobile — small phones can't afford the desktop py-16/gap-12 spacing
  // and still fit the dropzone + history strip + footer in one viewport. The
  // analyzed state keeps its scrolling layout because the palette + canvas +
  // history strip legitimately exceed a phone viewport.
  const rootClass = current
    ? "mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-12 px-6 py-16 sm:px-10 sm:py-24"
    : "mx-auto flex h-[100dvh] w-full max-w-4xl flex-col gap-6 overflow-hidden px-6 py-8 sm:gap-12 sm:px-10 sm:py-24";

  return (
    <div className={rootClass}>
      <header className="stagger-in stagger-1 flex items-baseline justify-between">
        <h1 className="font-serif text-3xl tracking-tight text-[var(--foreground)]">
          tone zone
        </h1>
        <p className="text-right text-[10px] uppercase tracking-[0.2em] leading-relaxed text-[var(--muted)]">
          a reference tool
          <br />
          <a
            href="https://neil.ink/"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-baseline gap-1 text-[var(--foreground)] underline decoration-[var(--muted)] decoration-1 underline-offset-4 transition-colors hover:text-[var(--accent)] hover:decoration-[var(--accent)]"
          >
            by neil
            <span aria-hidden="true" className="transition-transform group-hover:-translate-y-px group-hover:translate-x-px">
              ↗
            </span>
          </a>
        </p>
      </header>

      <hr className="stagger-in stagger-2 border-t border-[var(--border)]" />

      <main
        className={
          !current
            ? "flex flex-1 flex-col justify-center gap-6 sm:gap-10"
            : "flex flex-col gap-10"
        }
      >
        {!current && (
          <>
            <h2 className="stagger-in stagger-3 text-center font-serif text-4xl leading-snug text-[var(--foreground)]">
              Upload a reference.
            </h2>
            <div className="stagger-in stagger-4">
              <DropZone onFile={onUploadFile} />
            </div>
            {thumbEntries.length > 0 && (
              <div className="stagger-in stagger-5">
                <HistoryStrip
                  entries={thumbEntries}
                  currentId={currentId}
                  onSelect={onSelectHistory}
                  onRemove={onRemoveHistory}
                />
              </div>
            )}
          </>
        )}

        {current && (
          <>
            <div className="stagger-in stagger-3 flex items-baseline justify-between">
              <p className="font-mono text-xs text-[var(--muted)]">
                {current.file.name}
              </p>
              <button
                type="button"
                onClick={onReplace}
                className="text-[10px] uppercase tracking-widest text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                replace
              </button>
            </div>

            <div className="stagger-in stagger-4 relative min-h-64">
              <div
                className={`transition-opacity duration-300 ease-out ${
                  reanalyzing ? "opacity-40" : "opacity-100"
                }`}
              >
                {current.analyzed && current.bitmap ? (
                  <AnalyzedCanvas
                    result={current.analyzed.result}
                    zoneMap={current.analyzed.zoneMap}
                    zoneIndexData={current.analyzed.zoneIndexData}
                    referenceBitmap={current.bitmap}
                    mode={viewMode}
                    selectedZone={selectedZone}
                    lockedZone={lockedZone}
                    regionActive={regionZones !== null}
                    onHoveredZoneChange={setHoveredZone}
                    onLockedZoneChange={setLockedZone}
                    onRegionSelect={setRegionZones}
                  />
                ) : (
                  <div className="flex h-64 w-full items-center justify-center text-sm text-[var(--muted)]">
                    <span className="text-breath">
                      {inFlight ? "analyzing" : "preparing"}
                    </span>
                    <span className="dot-cycle ml-0.5">
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="stagger-in stagger-5">
              <ValueCountPicker
                value={current.n}
                onChange={onChangeN}
                disabled={!current.blob}
                notan={current.notan}
                onToggleNotan={onToggleNotan}
              />
            </div>

            {thumbEntries.length > 1 && (
              <div className="stagger-in stagger-5">
                <HistoryStrip
                  entries={thumbEntries}
                  currentId={currentId}
                  onSelect={onSelectHistory}
                  onRemove={onRemoveHistory}
                />
              </div>
            )}
          </>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-baseline gap-3 text-sm text-[var(--foreground)]"
          >
            <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--accent)]">
              error
            </span>
            <span className="flex-1">— {error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="dismiss error"
              className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              dismiss
            </button>
          </p>
        )}
      </main>

      {current && result && (
        <div className="stagger-in stagger-7 sticky bottom-0 z-10 flex flex-col gap-3 border-t border-[var(--border)] bg-[var(--background)] py-4">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <ModeToggle value={viewMode} onChange={setViewMode} disabled={!result} />
            <div className="flex items-center gap-4">
              {regionZones !== null && (
                <button
                  type="button"
                  onClick={() => setRegionZones(null)}
                  className="text-[10px] uppercase tracking-[0.2em] text-[var(--accent)] hover:text-[var(--foreground)]"
                >
                  region · {regionZones.length}{" "}
                  {regionZones.length === 1 ? "value" : "values"} ✕
                </button>
              )}
              <p className="min-h-5 font-mono text-sm tabular-nums text-[var(--foreground)]">
                {selectedZone !== null && selectedHex !== null && (
                  <>
                    V{selectedZone + 1}/{paletteSize}{" "}
                    <span className="text-[var(--border)]">·</span>{" "}
                    {selectedHex}
                    {lockedZone !== null && (
                      <span className="ml-3 hidden text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] sm:inline">
                        locked
                      </span>
                    )}
                  </>
                )}
              </p>
            </div>
          </div>
          <div
            className={`transition-opacity duration-300 ease-out ${
              reanalyzing ? "opacity-40" : "opacity-100"
            }`}
          >
            <PaletteStrip
              palette={result.palette}
              selectedZone={selectedZone}
              lockedZone={lockedZone}
              visibleZones={regionZones}
              onHoveredZoneChange={setHoveredZone}
              onLockedZoneChange={setLockedZone}
            />
          </div>
        </div>
      )}

      <footer className="stagger-in stagger-8 mt-auto flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-[var(--border)] pt-6 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        <span>value-study reference</span>
        <span aria-hidden="true">·</span>
        <Link
          href="/info"
          className="underline underline-offset-4 hover:text-[var(--foreground)]"
        >
          info
        </Link>
        <span aria-hidden="true">·</span>
        <a
          href="https://github.com/welcomeneil/tones"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-[var(--foreground)]"
        >
          view source
        </a>
      </footer>
    </div>
  );
}
