"use client";

import { useEffect, useMemo, useRef } from "react";
import type { AnalyzeResult, RenderMode } from "../lib/types";

type Props = {
  result: AnalyzeResult;
  zoneMap: ImageBitmap;
  zoneIndexData: ImageData;
  referenceBitmap: ImageBitmap;
  mode: RenderMode;
  selectedZone: number | null;
  lockedZone: number | null;
  onHoveredZoneChange: (zone: number | null) => void;
  onLockedZoneChange: (zone: number | null) => void;
};

// Bi-tonal bracket: vermilion core stroked over a cream halo. Both
// components stay visible across all luminosity values — vermilion reads
// on light/mid zones, cream reads on dark zones. Constant across zones so
// brackets never appear to change with selection.
const HALO_COLOR = "#f5f0e8";
const CORE_COLOR = "#e63946";
const HALO_LINE_DPX = 3.5;
const CORE_LINE_DPX = 1.5;
const BRACKET_ARM_DPX = 14;
const MIN_AREA_FRACTION = 0.0001; // skip components < 0.01% of image area
const MERGE_GAP_FRACTION = 0; // bboxes within this fraction of max(W,H) merge (0 = only true overlap)

type Bbox = { x0: number; y0: number; x1: number; y1: number; area: number };

export function AnalyzedCanvas({
  result,
  zoneMap,
  zoneIndexData,
  referenceBitmap,
  mode,
  selectedZone,
  lockedZone,
  onHoveredZoneChange,
  onLockedZoneChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  // Connected-component bounding boxes per zone, computed once per analyze
  // via union-find over the zone-index image. Used to draw corner brackets.
  const componentsByZone = useMemo(
    () => computeComponents(zoneIndexData),
    [zoneIndexData],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (mode === "zones") {
      ctx.drawImage(zoneMap, 0, 0);
    } else {
      ctx.drawImage(referenceBitmap, 0, 0, result.width, result.height);
    }
  }, [zoneMap, mode, referenceBitmap, result]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const base = canvasRef.current;
    if (!overlay || !base) return;

    const draw = () => {
      const rect = base.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const dw = Math.max(1, Math.round(rect.width * dpr));
      const dh = Math.max(1, Math.round(rect.height * dpr));
      if (overlay.width !== dw) overlay.width = dw;
      if (overlay.height !== dh) overlay.height = dh;
      const ctx = overlay.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, dw, dh);
      if (selectedZone === null) return;

      const comps = componentsByZone.get(selectedZone);
      if (!comps || comps.length === 0) return;

      const sx = dw / result.width;
      const sy = dh / result.height;
      const minArea = result.width * result.height * MIN_AREA_FRACTION;
      const path = new Path2D();
      for (const c of comps) {
        if (c.area < minArea) continue;
        const x0 = c.x0 * sx;
        const y0 = c.y0 * sy;
        const x1 = (c.x1 + 1) * sx;
        const y1 = (c.y1 + 1) * sy;
        const w = x1 - x0;
        const h = y1 - y0;
        // Bracket arm: short L at each corner, never longer than ~⅓ of side.
        const arm = Math.min(BRACKET_ARM_DPX, w / 3, h / 3);
        // top-left
        path.moveTo(x0, y0 + arm);
        path.lineTo(x0, y0);
        path.lineTo(x0 + arm, y0);
        // top-right
        path.moveTo(x1 - arm, y0);
        path.lineTo(x1, y0);
        path.lineTo(x1, y0 + arm);
        // bottom-right
        path.moveTo(x1, y1 - arm);
        path.lineTo(x1, y1);
        path.lineTo(x1 - arm, y1);
        // bottom-left
        path.moveTo(x0 + arm, y1);
        path.lineTo(x0, y1);
        path.lineTo(x0, y1 - arm);
      }
      ctx.lineCap = "square";
      ctx.lineJoin = "miter";
      ctx.strokeStyle = HALO_COLOR;
      ctx.lineWidth = HALO_LINE_DPX;
      ctx.stroke(path);
      ctx.strokeStyle = CORE_COLOR;
      ctx.lineWidth = CORE_LINE_DPX;
      ctx.stroke(path);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(base);
    return () => ro.disconnect();
  }, [componentsByZone, selectedZone, result]);

  const zoneAt = (e: React.MouseEvent<HTMLCanvasElement>): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * zoneIndexData.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * zoneIndexData.height);
    if (x < 0 || y < 0 || x >= zoneIndexData.width || y >= zoneIndexData.height) {
      return null;
    }
    const i = (y * zoneIndexData.width + x) * 4;
    return zoneIndexData.data[i];
  };

  return (
    <div className="relative w-full border border-[var(--border)]">
      <canvas
        ref={canvasRef}
        onMouseMove={(e) => onHoveredZoneChange(zoneAt(e))}
        onMouseLeave={() => onHoveredZoneChange(null)}
        onClick={(e) => {
          const z = zoneAt(e);
          if (z === null) return;
          onLockedZoneChange(lockedZone === z ? null : z);
        }}
        className="block h-auto w-full cursor-crosshair"
      />
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
    </div>
  );
}

// 4-connected components via union-find on the zone-index image. 8-conn was
// too aggressive: tonal-zone pixels scatter everywhere, so diagonal joins
// collapse most of a zone into one mega-component. Two passes: first builds
// equivalence classes, second aggregates bbox + area per root. Groups by
// zone, then fuses overlapping bboxes (no cascade — uses original distances
// via union-find on the bbox graph). ~30-50ms for 1M pixels.
function computeComponents(zi: ImageData): Map<number, Bbox[]> {
  const { width, height, data } = zi;
  const N = width * height;
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;

  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const z = data[i * 4];
      if (x > 0 && data[(i - 1) * 4] === z) union(i, i - 1);
      if (y > 0 && data[(i - width) * 4] === z) union(i, i - width);
    }
  }

  const roots = new Map<number, { zone: number; bbox: Bbox }>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const r = find(i);
      const z = data[i * 4];
      let entry = roots.get(r);
      if (!entry) {
        entry = { zone: z, bbox: { x0: x, y0: y, x1: x, y1: y, area: 0 } };
        roots.set(r, entry);
      }
      const b = entry.bbox;
      if (x < b.x0) b.x0 = x;
      if (y < b.y0) b.y0 = y;
      if (x > b.x1) b.x1 = x;
      if (y > b.y1) b.y1 = y;
      b.area++;
    }
  }

  const byZone = new Map<number, Bbox[]>();
  for (const { zone, bbox } of roots.values()) {
    let arr = byZone.get(zone);
    if (!arr) {
      arr = [];
      byZone.set(zone, arr);
    }
    arr.push(bbox);
  }

  const gap = Math.round(Math.max(width, height) * MERGE_GAP_FRACTION);
  const merged = new Map<number, Bbox[]>();
  for (const [zone, boxes] of byZone) {
    merged.set(zone, mergeBboxes(boxes, gap));
  }
  return merged;
}

// Cluster bboxes via union-find on a proximity graph built from ORIGINAL
// distances. Avoids the cascade of iterative merging — where a merged bbox
// grows large enough to swallow all the others. One bbox per cluster, sized
// to cover all sources, area summed.
function mergeBboxes(boxes: Bbox[], gap: number): Bbox[] {
  const n = boxes.length;
  if (n <= 1) return boxes;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    const a = boxes[i];
    for (let j = i + 1; j < n; j++) {
      const b = boxes[j];
      const disjoint =
        a.x1 + gap < b.x0 ||
        b.x1 + gap < a.x0 ||
        a.y1 + gap < b.y0 ||
        b.y1 + gap < a.y0;
      if (!disjoint) union(i, j);
    }
  }
  const groups = new Map<number, Bbox>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const b = boxes[i];
    const existing = groups.get(r);
    if (!existing) {
      groups.set(r, { ...b });
    } else {
      existing.x0 = Math.min(existing.x0, b.x0);
      existing.y0 = Math.min(existing.y0, b.y0);
      existing.x1 = Math.max(existing.x1, b.x1);
      existing.y1 = Math.max(existing.y1, b.y1);
      existing.area += b.area;
    }
  }
  return Array.from(groups.values());
}
