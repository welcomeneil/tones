// Per-boundary line styling for the stencil renderer. A "boundary" is one
// iso-contour set at level k ∈ [1, n-1] separating zones [0, k-1] from
// [k, n-1]. In tone_zone, zone index 0 is the DARKEST tone and n-1 the
// lightest.
//
// ORIENTATION (stencil-dark-emphasis branch): line weight DECREASES with k.
// Because zone 0 is the darkest tone, this gives the darkest-core boundary
// the heavy solid stroke and the lightest transitions the thin dotted
// hairline — heavy ink intuition, dark = dense. The `main` branch uses the
// inverse (light = heavy); the difference is the `t` line in styleForBoundary.

export type LineStyle = {
  strokeWidth: number; // in SVG user units (= image pixels in viewBox)
  dashArray: string | null;
  opacity: number;
};

export type StencilColor = "#1a1a1a" | "#4b0082";

export type StencilStyleOpts = {
  color: StencilColor;
  thicknessScale: number; // 1 = default; user can scale to taste
};

// Per-level style for boundary at level k (k ∈ [1, n-1]). Width interpolates
// 0.35 → 1.4 user units across the n-1 levels and is scaled by opts. Dash
// pattern is keyed to the lower 40% of levels so the lightest 1–2 boundaries
// read as "hint" linework and the darker ones read as confident structure.
export function styleForBoundary(
  level: number,
  n: number,
  opts: StencilStyleOpts,
): LineStyle {
  const denom = Math.max(1, n - 1);
  // t→1 = heaviest. Here t falls as k rises, so the darkest-core boundary
  // (k=1) is heaviest. The `main` branch uses `level / denom` (light = heavy).
  const t = (denom + 1 - level) / denom;
  const minW = 0.35;
  const maxW = 1.4;
  const strokeWidth = lerp(minW, maxW, t) * opts.thicknessScale;
  let dashArray: string | null;
  if (t < 0.2) {
    // Dotted hairline. Dash lengths scale with stroke so the dot reads as
    // round at any thickness setting.
    const u = Math.max(0.4, strokeWidth);
    dashArray = `${u} ${u * 3}`;
  } else if (t < 0.4) {
    const u = Math.max(0.8, strokeWidth);
    dashArray = `${u * 3} ${u * 1.5}`;
  } else {
    dashArray = null;
  }
  return { strokeWidth, dashArray, opacity: 1 };
}

export function styleTable(n: number, opts: StencilStyleOpts): LineStyle[] {
  const out: LineStyle[] = [];
  for (let k = 1; k < n; k++) out.push(styleForBoundary(k, n, opts));
  return out;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
