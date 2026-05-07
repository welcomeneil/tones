// 1-D weighted k-means over a 256-bin grayscale histogram. Ported from
// api/algorithms/kmeans_1d.py. Operates on values 0..255 with their
// histogram counts as weights, so cost is independent of image size
// once the histogram is computed.
//
// RNG note: numpy's default_rng uses PCG64; we use mulberry32 here for
// determinism with a tiny footprint. Same algorithm, same convergence
// behavior — but seeded outputs will not byte-match the Python pipeline.

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedChoice(
  weights: Float64Array,
  total: number,
  rand: () => number,
): number {
  // Inverse-CDF sample. Linear scan is fine: weights.length <= 256.
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function kmeansPlusPlusInit(
  values: Float64Array,
  weights: Float64Array,
  k: number,
  rand: () => number,
): Float64Array {
  const n = values.length;
  let weightSum = 0;
  for (let i = 0; i < n; i++) weightSum += weights[i];

  const first = weightedChoice(weights, weightSum, rand);
  const centers: number[] = [values[first]];

  const minD2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = values[i] - centers[0];
    minD2[i] = d * d;
  }

  const p = new Float64Array(n);
  for (let c = 1; c < k; c++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      p[i] = weights[i] * minD2[i];
      s += p[i];
    }
    const idx =
      s > 0 ? weightedChoice(p, s, rand) : weightedChoice(weights, weightSum, rand);
    centers.push(values[idx]);
    for (let i = 0; i < n; i++) {
      const d = values[i] - values[idx];
      const d2 = d * d;
      if (d2 < minD2[i]) minD2[i] = d2;
    }
  }

  centers.sort((a, b) => a - b);
  return Float64Array.from(centers);
}

function lloyd1D(
  values: Float64Array,
  weights: Float64Array,
  centers: Float64Array,
  maxIter = 100,
  tol = 1e-6,
): Float64Array {
  const n = values.length;
  const k = centers.length;
  const cur = Float64Array.from(centers);
  const next = new Float64Array(k);
  const sums = new Float64Array(k);
  const ws = new Float64Array(k);

  for (let iter = 0; iter < maxIter; iter++) {
    sums.fill(0);
    ws.fill(0);

    // Assign each value to its nearest center using midpoint thresholds.
    // Single linear sweep: values are sorted (0..255 ascending).
    let kIdx = 0;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      while (kIdx < k - 1 && v >= (cur[kIdx] + cur[kIdx + 1]) / 2) kIdx++;
      const w = weights[i];
      sums[kIdx] += v * w;
      ws[kIdx] += w;
    }

    for (let c = 0; c < k; c++) {
      next[c] = ws[c] === 0 ? cur[c] : sums[c] / ws[c];
    }

    // Sort in place — k is small.
    Array.prototype.sort.call(next, (a: number, b: number) => a - b);

    let maxDelta = 0;
    for (let c = 0; c < k; c++) {
      const d = Math.abs(next[c] - cur[c]);
      if (d > maxDelta) maxDelta = d;
      cur[c] = next[c];
    }
    if (maxDelta < tol) return cur;
  }
  return cur;
}

export function runKmeans1D(
  histogram: Uint32Array,
  n: number,
  seed = 0,
): { boundaries: Int32Array; zoneCount: number } {
  // Restrict to non-zero bins (matches the Python "mask = counts > 0").
  const usedValues: number[] = [];
  const usedWeights: number[] = [];
  for (let i = 0; i < 256; i++) {
    if (histogram[i] > 0) {
      usedValues.push(i);
      usedWeights.push(histogram[i]);
    }
  }
  const values = Float64Array.from(usedValues);
  const weights = Float64Array.from(usedWeights);
  const k = Math.min(n, values.length);

  const rand = mulberry32(seed);
  let centers = kmeansPlusPlusInit(values, weights, k, rand);
  centers = lloyd1D(values, weights, centers);
  Array.prototype.sort.call(centers, (a: number, b: number) => a - b);

  const boundaries = new Int32Array(Math.max(0, k - 1));
  for (let i = 0; i < boundaries.length; i++) {
    boundaries[i] = Math.round((centers[i] + centers[i + 1]) / 2);
  }
  return { boundaries, zoneCount: k };
}
