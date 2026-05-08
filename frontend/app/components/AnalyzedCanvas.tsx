"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

// Touch loupe: long-press engages a magnifier so users can target zones
// that read too close together for a fingertip. Quick drags still scroll
// because touch-action is pan-y until the long-press fires.
const LOUPE_DIAMETER = 132;
const LOUPE_ZOOM = 6;
const LOUPE_FINGER_OFFSET = 88;
const LONG_PRESS_MS = 320;
const MOVE_CANCEL_PX = 10;

type Bbox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  pixelCount: number;
};

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
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const wasTouchRef = useRef(false);
  const [loupeActive, setLoupeActive] = useState(false);

  // Connected-component bounding boxes per zone, computed once per analyze
  // via union-find over the zone-index image. Used to draw corner brackets.
  // ~30-50ms for 1M pixels on desktop; deferring this until first hover was
  // explored but trades worse interactive feedback for marginal first-paint.
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
      const minPixels = result.width * result.height * MIN_AREA_FRACTION;
      // Inset by half the halo stroke so brackets stay fully on-canvas
      // when a component's bbox hugs the image edges (e.g. dominant zone
      // spanning the whole frame). Without this, edge-aligned strokes get
      // clipped and the brackets appear missing.
      const inset = HALO_LINE_DPX;
      const path = new Path2D();
      for (const c of comps) {
        if (c.pixelCount < minPixels) continue;
        const x0 = Math.max(c.x0 * sx, inset);
        const y0 = Math.max(c.y0 * sy, inset);
        const x1 = Math.min((c.x1 + 1) * sx, dw - inset);
        const y1 = Math.min((c.y1 + 1) * sy, dh - inset);
        const w = x1 - x0;
        const h = y1 - y0;
        const arm = Math.min(BRACKET_ARM_DPX, w / 3, h / 3);
        path.moveTo(x0, y0 + arm);
        path.lineTo(x0, y0);
        path.lineTo(x0 + arm, y0);
        path.moveTo(x1 - arm, y0);
        path.lineTo(x1, y0);
        path.lineTo(x1, y0 + arm);
        path.moveTo(x1, y1 - arm);
        path.lineTo(x1, y1);
        path.lineTo(x1 - arm, y1);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let pressTimer: number | null = null;
    let startX = 0;
    let startY = 0;
    let inLoupe = false;
    let pickedZone: number | null = null;

    const zoneAtClient = (cx: number, cy: number): number | null => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((cx - rect.left) / rect.width) * zoneIndexData.width);
      const y = Math.floor(((cy - rect.top) / rect.height) * zoneIndexData.height);
      if (x < 0 || y < 0 || x >= zoneIndexData.width || y >= zoneIndexData.height) {
        return null;
      }
      const i = (y * zoneIndexData.width + x) * 4;
      return zoneIndexData.data[i];
    };

    const drawLoupe = (cx: number, cy: number) => {
      const loupe = loupeRef.current;
      if (!loupe) return;
      const ctx = loupe.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const px = LOUPE_DIAMETER * dpr;
      if (loupe.width !== px) loupe.width = px;
      if (loupe.height !== px) loupe.height = px;

      const rect = canvas.getBoundingClientRect();
      const sx = ((cx - rect.left) / rect.width) * canvas.width;
      const sy = ((cy - rect.top) / rect.height) * canvas.height;
      const srcSize = LOUPE_DIAMETER / LOUPE_ZOOM;

      ctx.save();
      ctx.clearRect(0, 0, px, px);
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
      ctx.clip();
      // Nearest-neighbor preserves the posterized zone boundaries; smoothing
      // would blur the very edges the user is trying to target.
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, px, px);
      ctx.drawImage(
        canvas,
        sx - srcSize / 2,
        sy - srcSize / 2,
        srcSize,
        srcSize,
        0,
        0,
        px,
        px,
      );
      ctx.restore();

      ctx.strokeStyle = HALO_COLOR;
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, px / 2 - 1.5 * dpr, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = CORE_COLOR;
      ctx.lineWidth = 1.5 * dpr;
      const ch = 7 * dpr;
      ctx.beginPath();
      ctx.moveTo(px / 2 - ch, px / 2);
      ctx.lineTo(px / 2 + ch, px / 2);
      ctx.moveTo(px / 2, px / 2 - ch);
      ctx.lineTo(px / 2, px / 2 + ch);
      ctx.stroke();

      // Flip below the finger when near the top of the viewport so the loupe
      // never gets clipped off-screen.
      const offset =
        cy - LOUPE_FINGER_OFFSET - LOUPE_DIAMETER / 2 < 8
          ? LOUPE_FINGER_OFFSET
          : -LOUPE_FINGER_OFFSET;
      loupe.style.left = `${cx - LOUPE_DIAMETER / 2}px`;
      loupe.style.top = `${cy + offset - LOUPE_DIAMETER / 2}px`;
    };

    const enterLoupe = (cx: number, cy: number) => {
      inLoupe = true;
      setLoupeActive(true);
      const z = zoneAtClient(cx, cy);
      pickedZone = z;
      onHoveredZoneChange(z);
      requestAnimationFrame(() => drawLoupe(cx, cy));
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      wasTouchRef.current = true;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        enterLoupe(startX, startY);
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (pressTimer !== null) {
        if (Math.hypot(t.clientX - startX, t.clientY - startY) > MOVE_CANCEL_PX) {
          window.clearTimeout(pressTimer);
          pressTimer = null;
        }
      }
      if (inLoupe) {
        // Need passive: false so this preventDefault actually suppresses scroll.
        e.preventDefault();
        const z = zoneAtClient(t.clientX, t.clientY);
        if (z !== pickedZone) {
          pickedZone = z;
          onHoveredZoneChange(z);
        }
        drawLoupe(t.clientX, t.clientY);
      }
    };

    const onTouchEnd = () => {
      if (pressTimer !== null) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
      if (inLoupe) {
        inLoupe = false;
        setLoupeActive(false);
        if (pickedZone !== null) onLockedZoneChange(pickedZone);
        onHoveredZoneChange(null);
        pickedZone = null;
      }
      // Leave the touch flag set briefly so the synthetic click that fires
      // after touchend doesn't re-trigger the desktop lock-toggle path.
      window.setTimeout(() => {
        wasTouchRef.current = false;
      }, 400);
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);

    return () => {
      if (pressTimer !== null) window.clearTimeout(pressTimer);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [zoneIndexData, onHoveredZoneChange, onLockedZoneChange]);

  const ariaLabel =
    mode === "zones"
      ? "tonal-zone map of the uploaded reference; click a zone to lock its bracket"
      : "uploaded reference image; click a zone to lock its bracket";

  return (
    <div className="relative w-full border border-[var(--border)]">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(e) => {
          if (lockedZone !== null) return;
          onHoveredZoneChange(zoneAt(e));
        }}
        onMouseLeave={() => {
          if (lockedZone !== null) return;
          onHoveredZoneChange(null);
        }}
        onClick={(e) => {
          if (wasTouchRef.current) return;
          const z = zoneAt(e);
          if (z === null) return;
          onLockedZoneChange(lockedZone === z ? null : z);
        }}
        style={{ touchAction: "pan-y" }}
        className="block h-auto w-full cursor-crosshair select-none"
      />
      <canvas
        ref={overlayRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <canvas
        ref={loupeRef}
        aria-hidden="true"
        style={{ width: LOUPE_DIAMETER, height: LOUPE_DIAMETER }}
        className={`pointer-events-none fixed z-50 rounded-full shadow-lg transition-opacity duration-150 ${
          loupeActive ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

// 4-connected components via union-find on the zone-index image. 8-conn was
// too aggressive: tonal-zone pixels scatter everywhere, so diagonal joins
// collapse most of a zone into one mega-component. Two passes: first builds
// equivalence classes, second aggregates bbox + pixelCount per root. Groups
// by zone, then fuses overlapping bboxes (no cascade — uses original
// distances via union-find on the bbox graph). ~30-50ms for 1M pixels.
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
        entry = { zone: z, bbox: { x0: x, y0: y, x1: x, y1: y, pixelCount: 0 } };
        roots.set(r, entry);
      }
      const b = entry.bbox;
      if (x < b.x0) b.x0 = x;
      if (y < b.y0) b.y0 = y;
      if (x > b.x1) b.x1 = x;
      if (y > b.y1) b.y1 = y;
      b.pixelCount++;
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
// to cover all sources, pixelCount summed.
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
      existing.pixelCount += b.pixelCount;
    }
  }
  return Array.from(groups.values());
}
