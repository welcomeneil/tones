// SVG + PDF renderers for stencil contours. Output viewBox is (0 0 W H) so
// downstream consumers (preview, print) scale uniformly. PDF generation lazy-
// imports pdf-lib so the initial bundle stays untouched until the artist
// actually exports.

import type { ContourSet } from "../algorithms/contours";
import type { LineStyle, StencilColor } from "./styles";

export type SvgOpts = {
  color: StencilColor;
  background?: "none" | "white"; // "none" for export; "white" optional for preview backdrop
};

export function contoursToSvg(
  set: ContourSet,
  styles: LineStyle[],
  opts: SvgOpts,
): string {
  const { width: W, height: H, boundaries } = set;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ` +
      `width="${W}" height="${H}" shape-rendering="geometricPrecision">`,
  );
  if (opts.background === "white") {
    parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  }
  parts.push(
    `<g fill="none" stroke="${opts.color}" stroke-linecap="round" stroke-linejoin="round">`,
  );
  // Paint in ascending stroke width so the heavier lines land on top wherever
  // contours visually touch — keeps the dominant boundary readable regardless
  // of which weight↔value orientation the style table uses.
  const ordered = boundaries
    .map((b) => ({ b, w: styles[b.level - 1]?.strokeWidth ?? 0 }))
    .sort((x, y) => x.w - y.w)
    .map((e) => e.b);
  for (const b of ordered) {
    const style = styles[b.level - 1];
    if (!style) continue;
    const dashAttr =
      style.dashArray !== null ? ` stroke-dasharray="${style.dashArray}"` : "";
    const opacityAttr =
      style.opacity !== 1 ? ` opacity="${style.opacity}"` : "";
    for (const pl of b.polylines) {
      const d = polylineToPathD(pl.points, pl.closed);
      parts.push(
        `<path d="${d}" stroke-width="${style.strokeWidth}"${dashAttr}${opacityAttr} data-level="${b.level}"/>`,
      );
    }
  }
  parts.push(`</g></svg>`);
  return parts.join("");
}

function polylineToPathD(points: readonly (readonly [number, number])[], closed: boolean): string {
  if (points.length === 0) return "";
  let d = `M${fmt(points[0][0])} ${fmt(points[0][1])}`;
  for (let i = 1; i < points.length; i++) {
    d += `L${fmt(points[i][0])} ${fmt(points[i][1])}`;
  }
  if (closed) d += "Z";
  return d;
}

// Two decimal places is enough resolution at the half-pixel grid we work in
// and shaves a noticeable chunk off SVG payload for high-N high-res images.
function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

// ── PDF export ───────────────────────────────────────────────────────────
// Lazy-loaded so the ~250kb pdf-lib chunk doesn't touch the initial bundle.
// Renders each polyline as a vector path at the requested physical size; one
// page sized to fit. Stroke widths are converted to physical units via the
// same image→page scale so the printed dash patterns match the on-screen
// preview.

export type PdfOpts = {
  color: StencilColor;
  physicalWidth: number; // e.g. 4
  unit: "in" | "cm";
  minStrokePt?: number; // floor so dotted hairlines actually transfer (default 0.85pt ≈ 0.3mm)
};

export async function contoursToPdf(
  set: ContourSet,
  styles: LineStyle[],
  opts: PdfOpts,
): Promise<Blob> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const { width: W, height: H, boundaries } = set;
  const pointsPerInch = 72;
  const inchesPerCm = 1 / 2.54;
  const widthIn = opts.unit === "cm" ? opts.physicalWidth * inchesPerCm : opts.physicalWidth;
  const widthPt = widthIn * pointsPerInch;
  const heightPt = (H / W) * widthPt;
  const scale = widthPt / W; // image-unit → page-pt
  const minStrokePt = opts.minStrokePt ?? 0.85;

  const doc = await PDFDocument.create();
  const page = doc.addPage([widthPt, heightPt]);

  const [r, g, b] = hexToRgb(opts.color);
  const color = rgb(r, g, b);

  for (const boundary of boundaries) {
    const style = styles[boundary.level - 1];
    if (!style) continue;
    const thickness = Math.max(minStrokePt, style.strokeWidth * scale);
    const dashArray = style.dashArray
      ? style.dashArray.split(/\s+/).map((s) => Number.parseFloat(s) * scale)
      : undefined;
    for (const pl of boundary.polylines) {
      const d = polylineToPdfPath(pl.points, pl.closed, scale, heightPt);
      if (!d) continue;
      page.drawSvgPath(d, {
        borderColor: color,
        borderWidth: thickness,
        borderOpacity: style.opacity,
        borderDashArray: dashArray,
      });
    }
  }

  const bytes = await doc.save();
  // Vercel: keep Blob construction in a portable shape (Uint8Array source).
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}

// pdf-lib's drawSvgPath uses PDF coordinates (origin bottom-left). Flip Y by
// emitting `heightPt - y*scale`. Build a path string with absolute moves and
// lines; pdf-lib parses standard SVG path syntax.
function polylineToPdfPath(
  points: readonly (readonly [number, number])[],
  closed: boolean,
  scale: number,
  heightPt: number,
): string {
  if (points.length === 0) return "";
  const fy = (y: number) => heightPt - y * scale;
  let d = `M ${fmt(points[0][0] * scale)} ${fmt(fy(points[0][1]))}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${fmt(points[i][0] * scale)} ${fmt(fy(points[i][1]))}`;
  }
  if (closed) d += " Z";
  return d;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace(/^#/, "");
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  return [r, g, b];
}

// ── Download helpers ─────────────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function svgStringToBlob(svg: string): Blob {
  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}
