// Shared primitives for tonal-zone segmentation, ported from
// api/algorithms/_shared.py and api/serialize.py. All operations work
// on a 1D Uint8Array of grayscale pixel values (length = width * height).

export class DegenerateImageError extends Error {
  readonly code = "degenerate_image";
  constructor(message: string) {
    super(message);
    this.name = "DegenerateImageError";
  }
}

export function bitmapToGrayscale(
  bitmap: ImageBitmap,
): { gray: Uint8Array; width: number; height: number } {
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  // Match PIL's "L" mode coefficients (Rec. 601 luma): L = 299/1000 R + 587/1000 G + 114/1000 B.
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114 + 500) / 1000 | 0;
  }
  return { gray, width, height };
}

export function computeHistogram(gray: Uint8Array): Uint32Array {
  const counts = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) counts[gray[i]]++;
  return counts;
}

export function requireTonalVariation(
  histogram: Uint32Array,
  minDistinct = 2,
): void {
  let distinct = 0;
  for (let i = 0; i < 256; i++) if (histogram[i] > 0) distinct++;
  if (distinct < minDistinct) {
    const plural = distinct !== 1 ? "s" : "";
    throw new DegenerateImageError(
      `image has too little tonal variation (${distinct} distinct value${plural}); ` +
        `upload an image with a range of light and dark values`,
    );
  }
}

// Match numpy.digitize: returns the index of the bin each value belongs in,
// where bins are monotonically increasing. boundaries.length zones means
// boundaries.length + 1 bins; output values are in [0, boundaries.length].
export function digitize(gray: Uint8Array, boundaries: Int32Array): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    let lo = 0;
    let hi = boundaries.length;
    // Binary search: smallest k such that v < boundaries[k]; k == hi means v >= all.
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (v < boundaries[mid]) hi = mid;
      else lo = mid + 1;
    }
    out[i] = lo;
  }
  return out;
}

export function paletteFromZones(
  gray: Uint8Array,
  zones: Uint8Array,
  zoneCount: number,
): number[] {
  const sums = new Float64Array(zoneCount);
  const counts = new Uint32Array(zoneCount);
  for (let i = 0; i < gray.length; i++) {
    const z = zones[i];
    sums[z] += gray[i];
    counts[z]++;
  }
  const palette: number[] = [];
  for (let z = 0; z < zoneCount; z++) {
    if (counts[z] === 0) continue;
    palette.push(Math.round(sums[z] / counts[z]));
  }
  return palette;
}

// Paint the flat-color zone map as an OffscreenCanvas, returning an ImageBitmap
// the main thread can drawImage directly. Replaces zone_map_to_png_bytes —
// no PNG encode/decode round-trip.
export function paintZoneMap(
  zones: Uint8Array,
  palette: number[],
  width: number,
  height: number,
): ImageBitmap {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  const img = ctx.createImageData(width, height);
  const data = img.data;
  for (let i = 0, j = 0; i < zones.length; i++, j += 4) {
    const v = palette[zones[i]];
    data[j] = v;
    data[j + 1] = v;
    data[j + 2] = v;
    data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.transferToImageBitmap();
}

// Build the zone-index ImageData directly. AnalyzedCanvas reads the zone
// number from data[i*4] (R channel), so R=G=B=zoneIndex, A=255.
export function buildZoneIndexImageData(
  zones: Uint8Array,
  width: number,
  height: number,
): ImageData {
  const img = new ImageData(width, height);
  const data = img.data;
  for (let i = 0, j = 0; i < zones.length; i++, j += 4) {
    const z = zones[i];
    data[j] = z;
    data[j + 1] = z;
    data[j + 2] = z;
    data[j + 3] = 255;
  }
  return img;
}
