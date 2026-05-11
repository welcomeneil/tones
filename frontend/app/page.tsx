"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnalyzedCanvas } from "./components/AnalyzedCanvas";
import { DropZone } from "./components/DropZone";
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

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [n, setN] = useState(DEFAULT_N);
  const [viewMode, setViewMode] = useState<RenderMode>("zones");
  const [analyzed, setAnalyzed] = useState<AnalyzedAssets | null>(null);
  const result = analyzed?.result ?? null;
  const [hoveredZone, setHoveredZone] = useState<number | null>(null);
  const [lockedZone, setLockedZone] = useState<number | null>(null);
  // Zone indices present inside a user-drawn region box; null = whole image.
  const [regionZones, setRegionZones] = useState<number[] | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const workerRef = useRef<ProcessWorkerClient | null>(null);
  const getWorker = () => {
    if (!workerRef.current) workerRef.current = new ProcessWorkerClient();
    return workerRef.current;
  };
  const selectedZone = hoveredZone ?? lockedZone;

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    downscaleImage(file)
      .then(({ blob: b, bitmap: bm }) => {
        if (cancelled) {
          bm.close();
          return;
        }
        setBitmap((prev) => {
          prev?.close();
          return bm;
        });
        setBlob(b);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to process image");
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    if (!blob || imageLoaded) return;
    const ctrl = new AbortController();
    // Lifecycle flag: this effect kicks off the worker.load, and inFlight
    // tracks its pending state until either load_ok or analyze_ok resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInFlight(true);
    getWorker()
      .load(blob, ctrl.signal)
      .then(() => {
        if (ctrl.signal.aborted) return;
        setImageLoaded(true);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : "load failed");
        setInFlight(false);
      });
    return () => ctrl.abort();
  }, [blob, imageLoaded]);

  useEffect(() => {
    if (!imageLoaded) return;
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setInFlight(true);
      setError(null);
      getWorker()
        .analyze(n, ctrl.signal)
        .then((msg) => {
          if (ctrl.signal.aborted) {
            msg.zoneMap.close();
            return;
          }
          const assets = toAnalyzedAssets(msg);
          setAnalyzed((prev) => {
            prev?.zoneMap.close();
            return assets;
          });
          setHoveredZone(null);
          setLockedZone(null);
          setRegionZones(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (ctrl.signal.aborted) return;
          setError(err instanceof Error ? err.message : "analyze failed");
        })
        .finally(() => {
          if (abortRef.current === ctrl) {
            setInFlight(false);
            abortRef.current = null;
          }
        });
    }, ANALYZE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [imageLoaded, n]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      workerRef.current?.terminate();
      workerRef.current = null;
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
  // Munsell value: 0 = black, 10 = white. 255-grayscale → /25.5.
  const munsellValue =
    selectedLum !== null ? (selectedLum / 25.5).toFixed(1) : null;
  const paletteSize = result?.palette.length ?? 0;

  const onReplace = () => {
    abortRef.current?.abort();
    workerRef.current?.reset();
    setFile(null);
    setBlob(null);
    setBitmap((prev) => {
      prev?.close();
      return null;
    });
    setImageLoaded(false);
    setAnalyzed((prev) => {
      prev?.zoneMap.close();
      return null;
    });
    setError(null);
    setHoveredZone(null);
    setLockedZone(null);
    setRegionZones(null);
    setInFlight(false);
    setN(DEFAULT_N);
    setViewMode("zones");
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-12 px-6 py-16 sm:px-10 sm:py-24">
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
        className={`flex flex-col gap-10 ${
          !file ? "flex-1 justify-center" : ""
        }`}
      >
        {!file && (
          <>
            <h2 className="stagger-in stagger-3 text-center font-serif text-4xl leading-snug text-[var(--foreground)]">
              Upload a reference.
            </h2>
            <div className="stagger-in stagger-4">
              <DropZone
                onFile={(f) => {
                  setError(null);
                  setFile(f);
                }}
              />
            </div>
          </>
        )}

        {file && (
          <>
            <div className="stagger-in stagger-3 flex items-baseline justify-between">
              <p className="font-mono text-xs text-[var(--muted)]">{file.name}</p>
              <button
                type="button"
                onClick={onReplace}
                className="text-[10px] uppercase tracking-widest text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                replace
              </button>
            </div>

            <div className="stagger-in stagger-4 relative min-h-64">
              {analyzed && bitmap ? (
                <AnalyzedCanvas
                  result={analyzed.result}
                  zoneMap={analyzed.zoneMap}
                  zoneIndexData={analyzed.zoneIndexData}
                  referenceBitmap={bitmap}
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

            <div className="stagger-in stagger-5">
              <ValueCountPicker value={n} onChange={setN} disabled={!blob} />
            </div>
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

      {file && result && (
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
                {selectedZone !== null && munsellValue !== null && (
                  <>
                    V{selectedZone + 1}/{paletteSize}{" "}
                    <span className="text-[var(--border)]">·</span> value{" "}
                    {munsellValue}
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
          <PaletteStrip
            palette={result.palette}
            selectedZone={selectedZone}
            lockedZone={lockedZone}
            visibleZones={regionZones}
            onHoveredZoneChange={setHoveredZone}
            onLockedZoneChange={setLockedZone}
          />
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
