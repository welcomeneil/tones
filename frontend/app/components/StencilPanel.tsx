"use client";

import { useEffect, useMemo, useState } from "react";
import { extractZoneContours } from "../lib/algorithms/contours";
import { styleTable, type StencilColor } from "../lib/stencil/styles";
import {
  contoursToPdf,
  contoursToSvg,
  downloadBlob,
  svgStringToBlob,
} from "../lib/stencil/render";
import type { AnalyzeResult } from "../lib/types";

type Props = {
  result: AnalyzeResult;
  zoneIndexData: ImageData;
  filenameHint: string; // e.g. uploaded filename, used as the export basename
  onClose: () => void;
};

export function StencilPanel({
  result,
  zoneIndexData,
  filenameHint,
  onClose,
}: Props) {
  const [color, setColor] = useState<StencilColor>("#4b0082");
  const [physicalWidth, setPhysicalWidth] = useState(4);
  const [unit, setUnit] = useState<"in" | "cm">("in");
  const [thicknessScale, setThicknessScale] = useState(1);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  // Enter animation: mount at translate-y-full then flip on next paint so the
  // transition runs once. Unmount immediately on close — exit animation is a
  // nice-to-have that would gate parent unmount on a timeout.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const contours = useMemo(
    () =>
      extractZoneContours(
        // R channel is the zone index — we grab a Uint8Array view rather than
        // copying. The data buffer is owned by ImageData; reading it is safe.
        zoneIndexToBuffer(zoneIndexData),
        result.width,
        result.height,
        result.n,
      ),
    [zoneIndexData, result.width, result.height, result.n],
  );

  const styles = useMemo(
    () => styleTable(result.n, { color, thicknessScale }),
    [result.n, color, thicknessScale],
  );

  const svg = useMemo(
    () => contoursToSvg(contours, styles, { color, background: "white" }),
    [contours, styles, color],
  );

  const exportBase = useMemo(() => sanitizeBasename(filenameHint), [filenameHint]);

  const onDownloadSvg = () => {
    // Re-render without the white preview backdrop so the printed/imported
    // SVG has a transparent background (cleaner for downstream editing).
    const exportSvg = contoursToSvg(contours, styles, { color, background: "none" });
    downloadBlob(svgStringToBlob(exportSvg), `${exportBase}-stencil.svg`);
  };

  const onDownloadPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const blob = await contoursToPdf(contours, styles, {
        color,
        physicalWidth,
        unit,
      });
      downloadBlob(
        blob,
        `${exportBase}-stencil-${physicalWidth}${unit}.pdf`,
      );
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "pdf export failed");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="export stencil"
      className="fixed inset-x-0 bottom-0 z-30 flex flex-col"
    >
      <button
        type="button"
        aria-label="close stencil panel"
        onClick={onClose}
        className={`flex-1 cursor-pointer bg-[var(--foreground)]/30 transition-opacity duration-300 ease-out ${
          shown ? "opacity-100" : "opacity-0"
        }`}
        style={{ minHeight: "10vh" }}
      />
      <div
        className={`flex max-h-[88vh] flex-col gap-6 border-t border-[var(--border)] bg-[var(--background)] px-6 py-6 transition-transform duration-300 ease-out sm:max-h-[78vh] sm:px-10 sm:py-8 ${
          shown ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-2xl text-[var(--foreground)]">
            stencil
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            close
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-6 overflow-hidden sm:grid-cols-[1fr_18rem] sm:gap-10">
          <div className="flex min-h-0 items-center justify-center overflow-auto border border-[var(--border)] bg-white">
            <div
              aria-label="stencil preview"
              className="flex h-full w-full items-center justify-center p-2 [&>svg]:max-h-full [&>svg]:max-w-full [&>svg]:object-contain"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>

          <div className="flex flex-col gap-6 overflow-y-auto">
            <Field label="ink">
              <div className="flex gap-1">
                <ToggleButton
                  active={color === "#4b0082"}
                  onClick={() => setColor("#4b0082")}
                >
                  violet
                </ToggleButton>
                <ToggleButton
                  active={color === "#1a1a1a"}
                  onClick={() => setColor("#1a1a1a")}
                >
                  black
                </ToggleButton>
              </div>
            </Field>

            <Field label="line styles">
              <ul className="flex flex-col gap-1.5">
                {styles.map((s, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Swatch value={result.palette[i]} label={`V${i + 1}`} />
                    <svg
                      width="92"
                      height="12"
                      viewBox="0 0 92 12"
                      aria-hidden="true"
                      className="flex-shrink-0"
                    >
                      <line
                        x1="2"
                        y1="6"
                        x2="90"
                        y2="6"
                        stroke={color}
                        strokeWidth={s.strokeWidth}
                        strokeDasharray={s.dashArray ?? undefined}
                        strokeLinecap="round"
                      />
                    </svg>
                    <Swatch value={result.palette[i + 1]} label={`V${i + 2}`} />
                  </li>
                ))}
              </ul>
            </Field>

            <Field label="thickness">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.1}
                  value={thicknessScale}
                  onChange={(e) => setThicknessScale(Number(e.target.value))}
                  className="tonal-slider flex-1"
                />
                <span className="w-10 text-right font-mono text-xs tabular-nums text-[var(--muted)]">
                  {thicknessScale.toFixed(1)}×
                </span>
              </div>
            </Field>

            <Field label="print size">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0.5}
                  max={20}
                  step={0.25}
                  value={physicalWidth}
                  onChange={(e) =>
                    setPhysicalWidth(Math.max(0.25, Number(e.target.value) || 0.25))
                  }
                  className="h-10 w-20 border border-[var(--border)] bg-transparent px-2 text-center font-mono text-sm tabular-nums outline-none focus:border-[var(--foreground)]"
                />
                <div className="flex gap-1">
                  <ToggleButton active={unit === "in"} onClick={() => setUnit("in")}>
                    in
                  </ToggleButton>
                  <ToggleButton active={unit === "cm"} onClick={() => setUnit("cm")}>
                    cm
                  </ToggleButton>
                </div>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
                width · height auto
              </p>
            </Field>

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={onDownloadSvg}
                className="flex h-11 items-center justify-center bg-[var(--foreground)] font-mono text-xs uppercase tracking-[0.2em] text-[var(--background)] transition-colors hover:bg-[var(--accent)]"
              >
                download svg
              </button>
              <button
                type="button"
                onClick={onDownloadPdf}
                disabled={pdfBusy}
                className="flex h-11 items-center justify-center border border-[var(--foreground)] font-mono text-xs uppercase tracking-[0.2em] text-[var(--foreground)] transition-colors hover:bg-[var(--foreground)] hover:text-[var(--background)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pdfBusy ? "preparing pdf…" : `download pdf · ${physicalWidth}${unit}`}
              </button>
              {pdfError && (
                <p role="alert" className="text-xs text-[var(--accent)]">
                  {pdfError}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}

// Each stencil line is a *boundary* between two tonal zones; the swatch pair
// flanking a line sample shows the artist exactly which two values that line
// weight separates — so the legend reads as "this weight = this transition".
function Swatch({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex flex-shrink-0 flex-col items-center gap-0.5">
      <span
        className="block h-6 w-6 border border-[var(--border)]"
        style={{ backgroundColor: `rgb(${value}, ${value}, ${value})` }}
      />
      <span className="font-mono text-[8px] tabular-nums tracking-wide text-[var(--muted)]">
        {label}
      </span>
    </span>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-9 min-w-12 items-center justify-center bg-[var(--border)] px-3 font-mono text-xs tabular-nums outline outline-1 -outline-offset-1 transition-[color,outline-color] duration-200 ease-out ${
        active
          ? "text-[var(--foreground)] outline-[var(--foreground)]"
          : "text-[var(--muted)] outline-transparent hover:text-[var(--foreground)]"
      }`}
    >
      {children}
    </button>
  );
}

// ImageData.data is a Uint8ClampedArray of RGBA; we want a Uint8Array of just
// the R channel (which holds the zone index, per shared.ts:buildZoneIndexImageData).
// Done as a single allocation + stride copy rather than a typed-array view
// because ClampedArray and Uint8Array share a buffer but not a stride.
function zoneIndexToBuffer(img: ImageData): Uint8Array {
  const { data, width, height } = img;
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) out[j] = data[i];
  return out;
}

function sanitizeBasename(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return stem.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "tone-zone";
}
