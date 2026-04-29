"use client";

import { useEffect, useRef, useState } from "react";
import { AlgoToggle, type AlgoMode } from "./components/AlgoToggle";
import { AnalyzedCanvas } from "./components/AnalyzedCanvas";
import { DropZone } from "./components/DropZone";
import { ModeToggle } from "./components/ModeToggle";
import { PaletteStrip } from "./components/PaletteStrip";
import { SigmaSlider } from "./components/SigmaSlider";
import { ValueCountPicker } from "./components/ValueCountPicker";
import { analyze } from "./lib/api";
import { downscaleImage } from "./lib/downscale";
import type { Algorithm, AnalyzeResult, RenderMode } from "./lib/types";

const DEBOUNCE_MS = 250;
const DEFAULT_SIGMA = 2.0;
const DEFAULT_N = 5;

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [algoMode, setAlgoMode] = useState<AlgoMode>("targeted");
  const [n, setN] = useState(DEFAULT_N);
  const [sigma, setSigma] = useState(DEFAULT_SIGMA);
  const [viewMode, setViewMode] = useState<RenderMode>("zones");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [hoveredZone, setHoveredZone] = useState<number | null>(null);
  const [lockedZone, setLockedZone] = useState<number | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const selectedZone = lockedZone ?? hoveredZone;
  const algo: Algorithm = algoMode === "targeted" ? "kmeans" : "peaks";

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
    if (!blob) return;
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setInFlight(true);
      setError(null);
      analyze(blob, { algo, n, sigma }, ctrl.signal)
        .then((r) => {
          if (ctrl.signal.aborted) return;
          setResult(r);
          setHoveredZone(null);
          setLockedZone(null);
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
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [blob, algo, n, sigma]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLockedZone(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const selectedLum =
    selectedZone !== null && result ? result.palette[selectedZone] ?? null : null;
  // Munsell value: 0 = black, 10 = white. 255-grayscale → /25.5.
  const munsellValue =
    selectedLum !== null ? (selectedLum / 25.5).toFixed(1) : null;
  const paletteSize = result?.palette.length ?? 0;

  const onReplace = () => {
    abortRef.current?.abort();
    setFile(null);
    setBlob(null);
    setBitmap((prev) => {
      prev?.close();
      return null;
    });
    setResult(null);
    setError(null);
    setHoveredZone(null);
    setLockedZone(null);
    setInFlight(false);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-12 px-6 py-16 sm:px-10 sm:py-24">
      <header className="flex items-start justify-between">
        <h1 className="font-serif text-3xl italic tracking-tight text-[var(--foreground)]">
          tone zone
        </h1>
        <p className="text-right text-[10px] uppercase tracking-[0.2em] leading-relaxed text-[var(--muted)]">
          a reference tool
          <br />
          <span className="text-[var(--foreground)]">by neil</span>
        </p>
      </header>

      <hr className="border-t border-[var(--border)]" />

      <main className="flex flex-col gap-10">
        {!file && (
          <>
            <h2 className="font-serif text-4xl leading-snug text-[var(--foreground)]">
              Upload a reference.
            </h2>
            <DropZone
              onFile={(f) => {
                setError(null);
                setFile(f);
              }}
            />
          </>
        )}

        {file && (
          <>
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-xs text-[var(--muted)]">{file.name}</p>
              <button
                type="button"
                onClick={onReplace}
                className="text-[10px] uppercase tracking-widest text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                replace
              </button>
            </div>

            <div className="min-h-64">
              {result && bitmap ? (
                <AnalyzedCanvas
                  result={result}
                  referenceBitmap={bitmap}
                  mode={viewMode}
                  selectedZone={selectedZone}
                  lockedZone={lockedZone}
                  onHoveredZoneChange={setHoveredZone}
                  onLockedZoneChange={setLockedZone}
                />
              ) : (
                <div className="flex h-64 w-full items-center justify-center text-sm italic text-[var(--muted)]">
                  {inFlight ? "analyzing…" : "preparing…"}
                </div>
              )}
            </div>

            <AlgoToggle value={algoMode} onChange={setAlgoMode} disabled={!blob} />

            {algoMode === "targeted" ? (
              <ValueCountPicker value={n} onChange={setN} disabled={!blob} />
            ) : (
              <SigmaSlider value={sigma} onChange={setSigma} disabled={!blob} />
            )}
          </>
        )}

        {error && (
          <p className="text-sm text-[var(--foreground)]">
            <span className="font-mono text-[var(--accent)]">error</span> — {error}
          </p>
        )}
      </main>

      {file && result && (
        <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-[var(--border)] bg-[var(--background)] py-4">
          <div className="flex items-center justify-between gap-6">
            <ModeToggle value={viewMode} onChange={setViewMode} disabled={!result} />
            <p className="font-mono text-sm tabular-nums text-[var(--foreground)]">
              {selectedZone !== null && munsellValue !== null && (
                <>
                  V{selectedZone + 1}/{paletteSize}{" "}
                  <span className="text-[var(--border)]">·</span> value{" "}
                  {munsellValue}
                  {lockedZone !== null && (
                    <span className="ml-3 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
                      locked · esc
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          <PaletteStrip
            palette={result.palette}
            selectedZone={selectedZone}
            lockedZone={lockedZone}
            onHoveredZoneChange={setHoveredZone}
            onLockedZoneChange={setLockedZone}
          />
        </div>
      )}

      <footer className="mt-auto border-t border-[var(--border)] pt-6 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        value-study reference · neil bisht · 2026 ·{" "}
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
