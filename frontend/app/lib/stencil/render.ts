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

// ── PNG export ───────────────────────────────────────────────────────────
// Rasterizes the contours directly onto a canvas at print resolution. The
// chosen physical size drives the pixel count at 600 DPI; a pHYs chunk is
// embedded so "print at actual size" lands at the right dimensions. Drawn
// straight with Path2D (no SVG round-trip) so strokes and dashes are clean.
//
// Stroke widths and dash lengths are scaled by exactly `scale` (and nothing
// else) so the rasterized output is a pixel-faithful enlargement of the SVG
// preview — same weight hierarchy, same dotted hairlines, no clamping.

const TARGET_DPI = 600; // line-art / thermal-stencil standard; crisp for Procreate
const METRES_PER_INCH = 0.0254;
// Cap the long edge so a 20-inch request can't allocate a huge canvas.
const MAX_CANVAS_PX = 6000;

export type PngOpts = {
  color: StencilColor;
  physicalWidth: number;
  unit: "in" | "cm";
};

export async function contoursToPng(
  set: ContourSet,
  styles: LineStyle[],
  opts: PngOpts,
): Promise<Blob> {
  const { width: W, height: H, boundaries } = set;
  const widthIn =
    opts.unit === "cm" ? opts.physicalWidth / 2.54 : opts.physicalWidth;

  let widthPx = Math.round(widthIn * TARGET_DPI);
  let heightPx = Math.round((H / W) * widthPx);
  let dpi = TARGET_DPI;
  const longest = Math.max(widthPx, heightPx);
  if (longest > MAX_CANVAS_PX) {
    const factor = MAX_CANVAS_PX / longest;
    widthPx = Math.round(widthPx * factor);
    heightPx = Math.round(heightPx * factor);
    dpi = TARGET_DPI * factor;
  }

  const scale = widthPx / W; // image-unit → device px

  const canvas = new OffscreenCanvas(widthPx, heightPx);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.strokeStyle = opts.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Ascending stroke width so heavier lines paint over lighter ones — matches
  // contoursToSvg's paint order.
  const ordered = boundaries
    .map((b) => ({ b, w: styles[b.level - 1]?.strokeWidth ?? 0 }))
    .sort((x, y) => x.w - y.w)
    .map((e) => e.b);

  for (const boundary of ordered) {
    const style = styles[boundary.level - 1];
    if (!style) continue;
    ctx.lineWidth = style.strokeWidth * scale;
    ctx.setLineDash(
      style.dashArray
        ? style.dashArray
            .split(/\s+/)
            .map((s) => Number.parseFloat(s) * scale)
        : [],
    );
    const path = new Path2D();
    for (const pl of boundary.polylines) {
      const pts = pl.points;
      if (pts.length === 0) continue;
      path.moveTo(pts[0][0] * scale, pts[0][1] * scale);
      for (let i = 1; i < pts.length; i++) {
        path.lineTo(pts[i][0] * scale, pts[i][1] * scale);
      }
      if (pl.closed) path.closePath();
    }
    ctx.stroke(path);
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  const tagged = embedPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
  return new Blob([tagged], { type: "image/png" });
}

// Inject a pHYs chunk so the PNG carries its true print resolution. IHDR is
// always the first chunk and always 13 data bytes, so it ends at a fixed
// offset (8-byte signature + 25-byte IHDR chunk); pHYs is inserted right
// after it, which satisfies the "before IDAT" ordering rule.
function embedPngDpi(png: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  const ppm = Math.round(dpi / METRES_PER_INCH); // pixels per metre
  const typeAndData = new Uint8Array(13); // "pHYs" + 9 data bytes
  typeAndData.set([0x70, 0x48, 0x59, 0x73], 0);
  const dv = new DataView(typeAndData.buffer);
  dv.setUint32(4, ppm);
  dv.setUint32(8, ppm);
  typeAndData[12] = 1; // unit specifier: metre

  const chunk = new Uint8Array(21); // len(4) + type+data(13) + crc(4)
  const cdv = new DataView(chunk.buffer);
  cdv.setUint32(0, 9); // pHYs data length
  chunk.set(typeAndData, 4);
  cdv.setUint32(17, crc32(typeAndData));

  const insertAt = 33;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(png.subarray(insertAt), insertAt + chunk.length);
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
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
