// Histogram-peaks segmentation. Ported from api/algorithms/histogram_peaks.py.
//
// Smooths the 256-bin histogram with a 1D Gaussian and uses local minima
// (valleys between modes) as zone boundaries. Matches scipy defaults:
//   gaussian_filter1d(mode='reflect', truncate=4.0)
//   find_peaks (no constraints, plateau midpoint)

function gaussianKernel(sigma: number, truncate = 4.0): Float64Array {
  // scipy: lw = int(truncate * sigma + 0.5); kernel length = 2*lw + 1.
  const lw = Math.floor(truncate * sigma + 0.5);
  const size = 2 * lw + 1;
  const kernel = new Float64Array(size);
  const twoSigmaSq = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -lw; i <= lw; i++) {
    const v = Math.exp(-(i * i) / twoSigmaSq);
    kernel[i + lw] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return kernel;
}

function gaussianFilter1DReflect(
  counts: Uint32Array,
  sigma: number,
): Float64Array {
  const n = counts.length;
  const out = new Float64Array(n);
  if (sigma <= 0) {
    for (let i = 0; i < n; i++) out[i] = counts[i];
    return out;
  }
  const kernel = gaussianKernel(sigma);
  const lw = (kernel.length - 1) / 2;
  // 'reflect' boundary (a.k.a. half-sample symmetric): index -1 mirrors to 0,
  // -2 to 1, ..., n to n-1, n+1 to n-2, etc.
  const reflect = (idx: number): number => {
    if (idx < 0) return -idx - 1;
    if (idx >= n) return 2 * n - idx - 1;
    return idx;
  };

  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -lw; j <= lw; j++) {
      acc += counts[reflect(i + j)] * kernel[j + lw];
    }
    out[i] = acc;
  }
  return out;
}

// scipy.signal.find_peaks with default args: returns indices of strict local
// maxima. For flat plateaus (consecutive equal values bounded by lower
// neighbors on both sides), returns the midpoint index of the plateau.
function findPeaks(values: Float64Array): number[] {
  const peaks: number[] = [];
  const n = values.length;
  let i = 1;
  const iMax = n - 1;
  while (i < iMax) {
    if (values[i - 1] < values[i]) {
      // Find end of any plateau.
      let iAhead = i + 1;
      while (iAhead < iMax && values[iAhead] === values[i]) iAhead++;
      if (values[iAhead] < values[i]) {
        // Plateau midpoint (matches scipy's behavior).
        const mid = (i + iAhead - 1) >>> 1;
        peaks.push(mid);
        i = iAhead;
      } else {
        i = iAhead;
      }
    } else {
      i++;
    }
  }
  return peaks;
}

export function runPeaks(
  histogram: Uint32Array,
  sigma: number,
): { boundaries: Int32Array; zoneCount: number } {
  const smoothed = gaussianFilter1DReflect(histogram, sigma);
  // Negate to find valleys (local minima of the smoothed histogram).
  const negated = new Float64Array(smoothed.length);
  for (let i = 0; i < smoothed.length; i++) negated[i] = -smoothed[i];
  const valleys = findPeaks(negated);
  const boundaries = Int32Array.from(valleys);
  return { boundaries, zoneCount: boundaries.length + 1 };
}
