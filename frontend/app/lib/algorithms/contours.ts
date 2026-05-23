// Marching-squares contour extraction over a per-pixel zone-index map. Each
// pixel holds a zone index in [0, n-1]; for every threshold k in [1, n-1] we
// extract the iso-contour separating "zone < k" from "zone >= k". This yields
// n-1 boundary sets — every segment has one unambiguous "darker side" (level
// k), which the stencil style table maps to a unique stroke weight/dash.
//
// The grid is padded by a 1-pixel sentinel ring of zeros so contours always
// close (regions that touch the image edge become loops along the boundary).
// Endpoints land on half-integer image-space coords; we clamp to [0, W]×[0, H]
// so the output fits cleanly inside an SVG viewBox of (0 0 W H).

export type Point = readonly [number, number];
export type Polyline = { points: Point[]; closed: boolean };
export type ZoneBoundary = { level: number; polylines: Polyline[] };
export type ContourSet = {
  width: number;
  height: number;
  n: number;
  boundaries: ZoneBoundary[];
};

export type ExtractOpts = {
  epsilon?: number;
  minLoopPerimeter?: number;
};

export function extractZoneContours(
  zoneIndex: Uint8Array,
  width: number,
  height: number,
  n: number,
  opts: ExtractOpts = {},
): ContourSet {
  const longest = Math.max(width, height);
  // Below ~0.5 we keep grid-staircase noise; above ~2 we eat fingertips.
  const epsilon = opts.epsilon ?? Math.max(0.75, longest / 1400);
  const minLoopPerimeter = opts.minLoopPerimeter ?? 0;

  const boundaries: ZoneBoundary[] = [];
  for (let k = 1; k < n; k++) {
    const raw = marchAtThreshold(zoneIndex, width, height, k);
    const polylines: Polyline[] = [];
    for (const pl of raw) {
      const simplified = simplify(pl.points, epsilon, pl.closed);
      if (simplified.length < 2) continue;
      if (pl.closed && minLoopPerimeter > 0) {
        if (perimeter(simplified) < minLoopPerimeter) continue;
      }
      polylines.push({ points: simplified, closed: pl.closed });
    }
    boundaries.push({ level: k, polylines });
  }
  return { width, height, n, boundaries };
}

// Marching squares over the binary mask {zone[p] >= threshold}. Returns
// chained polylines (loops where head==tail, open otherwise). Padded by a
// 1px zero ring so edge-touching regions produce closed loops along the
// image boundary instead of dangling open ends.
function marchAtThreshold(
  zoneIndex: Uint8Array,
  W: number,
  H: number,
  threshold: number,
): Polyline[] {
  const PW = W + 2;
  const PH = H + 2;
  const mask = new Uint8Array(PW * PH); // 0 outside padding ring
  for (let y = 0; y < H; y++) {
    const rowSrc = y * W;
    const rowDst = (y + 1) * PW + 1;
    for (let x = 0; x < W; x++) {
      mask[rowDst + x] = zoneIndex[rowSrc + x] >= threshold ? 1 : 0;
    }
  }

  // Endpoints live at half-integer coords in padded space; we shift by -1
  // when emitting to land in image space [0, W] × [0, H]. Encode each
  // endpoint as an integer key = py * (2*PW + 1) + px where px = 2*x_pad,
  // py = 2*y_pad. Both even or one odd — same scheme uniquely identifies
  // every cell-edge midpoint.
  const KEY_STRIDE = 2 * PW + 1;

  // Dense storage of unique endpoints + adjacency.
  const pointXs: number[] = [];
  const pointYs: number[] = [];
  const keyToIdx = new Map<number, number>();
  // Each endpoint touches at most 2 segments (the cell edge it sits on is
  // shared by at most 2 cells). -1 = empty slot.
  const segA: number[] = [];
  const segB: number[] = [];
  // Flat pairs [a0, b0, a1, b1, ...] of segment endpoint indices.
  const segs: number[] = [];

  const addPoint = (xPad2: number, yPad2: number): number => {
    const key = yPad2 * KEY_STRIDE + xPad2;
    const found = keyToIdx.get(key);
    if (found !== undefined) return found;
    const idx = pointXs.length;
    keyToIdx.set(key, idx);
    // Half-integer padded coords → image-space coords. xPad2/2 - 1.
    pointXs.push(xPad2 * 0.5 - 1);
    pointYs.push(yPad2 * 0.5 - 1);
    segA.push(-1);
    segB.push(-1);
    return idx;
  };

  const addSegment = (a: number, b: number) => {
    const sid = segs.length >>> 1;
    segs.push(a, b);
    if (segA[a] === -1) segA[a] = sid;
    else segB[a] = sid;
    if (segA[b] === -1) segA[b] = sid;
    else segB[b] = sid;
  };

  // Cell (i, j) in padded space: i ∈ [0, PW-2], j ∈ [0, PH-2]. Corner values
  // TL=mask[i, j], TR=mask[i+1, j], BR=mask[i+1, j+1], BL=mask[i, j+1].
  // Case key = TL<<3 | TR<<2 | BR<<1 | BL.
  //
  // Endpoint coords on cell edges (xPad2, yPad2) where the *2 encoding gives
  // integer-key safe arithmetic:
  //   top:    (2i + 1, 2j)
  //   right:  (2i + 2, 2j + 1)
  //   bottom: (2i + 1, 2j + 2)
  //   left:   (2i,     2j + 1)
  for (let j = 0; j < PH - 1; j++) {
    const row0 = j * PW;
    const row1 = row0 + PW;
    for (let i = 0; i < PW - 1; i++) {
      const tl = mask[row0 + i];
      const tr = mask[row0 + i + 1];
      const br = mask[row1 + i + 1];
      const bl = mask[row1 + i];
      const cs = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (cs === 0 || cs === 15) continue;

      const i2 = i << 1;
      const j2 = j << 1;
      // Ambiguous saddle cases 5 and 10 each emit two segments; we use the
      // "lower" disambiguation (treat both 1-vertices as disconnected). On
      // a discrete label map this is unambiguous and consistent.
      switch (cs) {
        case 1: { // 0001 BL
          const a = addPoint(i2,     j2 + 1);
          const b = addPoint(i2 + 1, j2 + 2);
          addSegment(a, b); break;
        }
        case 2: { // 0010 BR
          const a = addPoint(i2 + 1, j2 + 2);
          const b = addPoint(i2 + 2, j2 + 1);
          addSegment(a, b); break;
        }
        case 3: { // 0011 BL+BR
          const a = addPoint(i2,     j2 + 1);
          const b = addPoint(i2 + 2, j2 + 1);
          addSegment(a, b); break;
        }
        case 4: { // 0100 TR
          const a = addPoint(i2 + 1, j2);
          const b = addPoint(i2 + 2, j2 + 1);
          addSegment(a, b); break;
        }
        case 5: { // 0101 TR+BL — saddle
          const a = addPoint(i2 + 1, j2);
          const b = addPoint(i2 + 2, j2 + 1);
          addSegment(a, b);
          const c = addPoint(i2,     j2 + 1);
          const d = addPoint(i2 + 1, j2 + 2);
          addSegment(c, d); break;
        }
        case 6: { // 0110 TR+BR
          const a = addPoint(i2 + 1, j2);
          const b = addPoint(i2 + 1, j2 + 2);
          addSegment(a, b); break;
        }
        case 7: { // 0111 TR+BR+BL
          const a = addPoint(i2 + 1, j2);
          const b = addPoint(i2,     j2 + 1);
          addSegment(a, b); break;
        }
        case 8: { // 1000 TL
          const a = addPoint(i2 + 1, j2);
          const b = addPoint(i2,     j2 + 1);
          addSegment(a, b); break;
        }
        case 9: { // 1001 TL+BL
          const a = addPoint(i2 + 1, j2);
          const b = addPoint(i2 + 1, j2 + 2);
          addSegment(a, b); break;
        }
        case 10: { // 1010 TL+BR — saddle
          const a = addPoint(i2 + 1, j2);
          const b = addPoint(i2,     j2 + 1);
          addSegment(a, b);
          const c = addPoint(i2 + 2, j2 + 1);
          const d = addPoint(i2 + 1, j2 + 2);
          addSegment(c, d); break;
        }
        case 11: { // 1011 TL+BR+BL
          const a = addPoint(i2 + 1, j2);
          const b = addPoint(i2 + 2, j2 + 1);
          addSegment(a, b); break;
        }
        case 12: { // 1100 TL+TR
          const a = addPoint(i2,     j2 + 1);
          const b = addPoint(i2 + 2, j2 + 1);
          addSegment(a, b); break;
        }
        case 13: { // 1101 TL+TR+BL
          const a = addPoint(i2 + 2, j2 + 1);
          const b = addPoint(i2 + 1, j2 + 2);
          addSegment(a, b); break;
        }
        case 14: { // 1110 TL+TR+BR
          const a = addPoint(i2,     j2 + 1);
          const b = addPoint(i2 + 1, j2 + 2);
          addSegment(a, b); break;
        }
      }
    }
  }

  // Chain segments into polylines via the per-endpoint segment refs.
  const numSegs = segs.length >>> 1;
  const visited = new Uint8Array(numSegs);
  const polylines: Polyline[] = [];

  const otherEndpoint = (sid: number, pt: number): number => {
    const a = segs[sid * 2];
    const b = segs[sid * 2 + 1];
    return a === pt ? b : a;
  };
  const nextSegment = (pt: number, exclude: number): number => {
    const s1 = segA[pt];
    const s2 = segB[pt];
    if (s1 !== -1 && s1 !== exclude && !visited[s1]) return s1;
    if (s2 !== -1 && s2 !== exclude && !visited[s2]) return s2;
    return -1;
  };
  const mkPoint = (idx: number): Point => {
    // Clamp to image bounds — padding-ring contours can produce coords at
    // -0.5 or W+0.5 by construction; we want everything inside the viewBox.
    const x = pointXs[idx];
    const y = pointYs[idx];
    return [
      x < 0 ? 0 : x > W ? W : x,
      y < 0 ? 0 : y > H ? H : y,
    ];
  };

  for (let sid = 0; sid < numSegs; sid++) {
    if (visited[sid]) continue;
    visited[sid] = 1;
    const startPt = segs[sid * 2];
    const endPt = segs[sid * 2 + 1];
    const pts: Point[] = [mkPoint(startPt), mkPoint(endPt)];

    // Walk forward from endPt.
    let prevSeg = sid;
    let cur = endPt;
    let closed = false;
    while (true) {
      const ns = nextSegment(cur, prevSeg);
      if (ns === -1) break;
      visited[ns] = 1;
      const next = otherEndpoint(ns, cur);
      if (next === startPt) { closed = true; break; }
      pts.push(mkPoint(next));
      prevSeg = ns;
      cur = next;
    }

    if (!closed) {
      // Walk backward from startPt.
      prevSeg = sid;
      cur = startPt;
      while (true) {
        const ns = nextSegment(cur, prevSeg);
        if (ns === -1) break;
        visited[ns] = 1;
        const next = otherEndpoint(ns, cur);
        if (next === endPt) { closed = true; break; }
        pts.unshift(mkPoint(next));
        prevSeg = ns;
        cur = next;
      }
    }

    polylines.push({ points: pts, closed });
  }

  return polylines;
}

// Ramer–Douglas–Peucker. For closed loops, split at the vertex farthest from
// points[0] and RDP each arc — naïvely RDPing a closed path can collapse it
// because endpoints coincide, making perpendicular distance from line(a,b)
// degenerate.
function simplify(points: Point[], epsilon: number, closed: boolean): Point[] {
  if (points.length < 3) return points.slice();
  if (closed) {
    let maxD2 = -1;
    let pivot = 0;
    const p0 = points[0];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i][0] - p0[0];
      const dy = points[i][1] - p0[1];
      const d2 = dx * dx + dy * dy;
      if (d2 > maxD2) { maxD2 = d2; pivot = i; }
    }
    if (pivot < 2 || pivot > points.length - 2) return points.slice();
    const arc1 = rdp(points, 0, pivot, epsilon);
    const arc2 = rdp(points, pivot, points.length - 1, epsilon);
    return arc1.concat(arc2.slice(1));
  }
  return rdp(points, 0, points.length - 1, epsilon);
}

function rdp(points: Point[], i: number, j: number, epsilon: number): Point[] {
  if (j - i < 2) return [points[i], points[j]];
  const a = points[i];
  const b = points[j];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const den = Math.hypot(dx, dy);
  let maxD = -1;
  let idx = i;
  if (den === 0) {
    for (let k = i + 1; k < j; k++) {
      const ex = points[k][0] - a[0];
      const ey = points[k][1] - a[1];
      const d = Math.hypot(ex, ey);
      if (d > maxD) { maxD = d; idx = k; }
    }
  } else {
    for (let k = i + 1; k < j; k++) {
      const p = points[k];
      const num = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]);
      const d = num / den;
      if (d > maxD) { maxD = d; idx = k; }
    }
  }
  if (maxD <= epsilon) return [a, b];
  const left = rdp(points, i, idx, epsilon);
  const right = rdp(points, idx, j, epsilon);
  return left.concat(right.slice(1));
}

function perimeter(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    total += Math.hypot(dx, dy);
  }
  return total;
}
