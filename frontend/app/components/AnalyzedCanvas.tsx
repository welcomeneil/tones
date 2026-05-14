"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalyzeResult, RenderMode } from "../lib/types";

type Props = {
  result: AnalyzeResult;
  zoneMap: ImageBitmap;
  zoneIndexData: ImageData;
  referenceBitmap: ImageBitmap;
  mode: RenderMode;
  selectedZone: number | null;
  lockedZone: number | null;
  regionActive: boolean;
  onHoveredZoneChange: (zone: number | null) => void;
  onLockedZoneChange: (zone: number | null) => void;
  onRegionSelect: (zones: number[] | null) => void;
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
const LOUPE_ZOOM = 2.5;
// Loupe sits fully up-and-left of the finger so the thumb (coming in from
// below-right on most grips) doesn't occlude it. With LOUPE_DIAMETER 132 →
// radius 66, offsets of (-80, -100) put the loupe's bottom-right corner at
// (fx-14, fy-34) — clear of a typical thumb pad. The crosshair targets
// whatever is under the loupe glass itself, not under the finger — the user
// aims by aligning the loupe over the target.
const LOUPE_OFFSET_X = -80;
const LOUPE_OFFSET_Y = -100;
const LONG_PRESS_MS = 320;
const MOVE_CANCEL_PX = 10;

// Pan/zoom: ctrl/⌘+wheel on desktop (also covers Mac trackpad pinch, which
// the OS surfaces as ctrlKey wheel events), 2-finger pinch on mobile. Plain
// wheel and 1-finger drag are intentionally untouched so page scrolling and
// the long-press loupe keep their existing behavior.
const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const WHEEL_SENSITIVITY = 0.005;
// Gentle back-out: a touch of overshoot for life, well short of the original
// 1.56 spring so the bounce reads as a settle rather than a snap-and-rebound.
// Duration nudged up to give the softer curve room to breathe.
const RESET_EASING = "cubic-bezier(0.33, 1.15, 0.55, 1)";
const RESET_DURATION_MS = 360;

// Region select (desktop): plain left-drag a box → zoom to fit and filter the
// palette to the zones present inside it. A bare click (no drag past the
// threshold) still falls through to the lock-zone handler on the canvas.
const REGION_DRAG_PX = 6; // pointer travel before a press becomes a drawn box
const REGION_MIN_PX = 16; // boxes thinner than this on either side are ignored

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
  regionActive,
  onHoveredZoneChange,
  onLockedZoneChange,
  onRegionSelect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const wasTouchRef = useRef(false);
  const [loupeActive, setLoupeActive] = useState(false);
  const [zoom, setZoom] = useState({ s: 1, tx: 0, ty: 0 });
  const [zoomTransition, setZoomTransition] = useState(false);
  // Live box-select state: dragRect is wrapper-local CSS px (for the visible
  // rectangle); dragRef holds the in-progress gesture, suppressClickRef eats
  // the synthetic click that trails a completed drag.
  const [dragRect, setDragRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const dragRef = useRef({ active: false, moved: false, startX: 0, startY: 0 });
  const suppressClickRef = useRef(false);
  // Mirror state into a ref so touch handlers (bound once) can read latest
  // zoom without rebinding listeners — rebinding mid-gesture drops events.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Snap back to natural size whenever a new analyze completes. Comparing the
  // image dimensions, not the result object identity, avoids resetting on
  // unrelated re-renders (mode toggle, locked-zone changes). Lifecycle reset
  // tied to an external value, not a derivation — setState in effect is
  // intentional here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoom({ s: 1, tx: 0, ty: 0 });
    setZoomTransition(false);
  }, [result.width, result.height]);

  // maxS defaults to ZOOM_MAX for wheel/pinch (normal feel), but the region-
  // zoom path passes Infinity so a tiny user-drawn box can fully fill the
  // viewport regardless of the wheel cap.
  const clampZoom = useCallback(
    (s: number, tx: number, ty: number, maxS: number = ZOOM_MAX) => {
      const wrapper = wrapperRef.current;
      const cs = Math.max(ZOOM_MIN, Math.min(maxS, s));
      if (!wrapper) return { s: cs, tx, ty };
      const rect = wrapper.getBoundingClientRect();
      // transform-origin is 0 0, so at scale cs the content extends from tx to
      // tx + width*cs. Clamp so the content always covers the wrapper viewport.
      const minTx = rect.width - rect.width * cs;
      const minTy = rect.height - rect.height * cs;
      return {
        s: cs,
        tx: Math.min(0, Math.max(minTx, tx)),
        ty: Math.min(0, Math.max(minTy, ty)),
      };
    },
    [],
  );

  const resetZoom = () => {
    setZoomTransition(true);
    setZoom({ s: 1, tx: 0, ty: 0 });
    onRegionSelect(null);
    window.setTimeout(() => setZoomTransition(false), RESET_DURATION_MS + 20);
  };

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
      // offsetWidth/Height instead of getBoundingClientRect so the overlay
      // backing store is sized from the pre-transform layout box. Under heavy
      // zoom the rect grows past the browser's max canvas size (~16384px),
      // and the overlay paints blank — which reads as the whole canvas going
      // white because it sits on top of the base.
      const dpr = window.devicePixelRatio || 1;
      const dw = Math.max(1, Math.round(base.offsetWidth * dpr));
      const dh = Math.max(1, Math.round(base.offsetHeight * dpr));
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

  // Desktop wheel zoom. ctrl/meta gates this so plain wheel still scrolls the
  // page — the canvas lives inside a tall layout, and silently swallowing
  // wheel events while the cursor passes over it would feel broken. On macOS
  // trackpad pinch arrives as a synthesized ctrlKey wheel event, so the same
  // handler covers it without extra detection.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY);
      const rect = wrapper.getBoundingClientRect();
      const ax = e.clientX - rect.left;
      const ay = e.clientY - rect.top;
      setZoomTransition(false);
      setZoom((prev) => {
        // Honour any region zoom already past ZOOM_MAX so wheel-out doesn't
        // snap them back down; wheel-in past the prevailing max is still capped.
        const maxS = Math.max(ZOOM_MAX, prev.s);
        const newS = Math.max(ZOOM_MIN, Math.min(maxS, prev.s * factor));
        if (newS === prev.s) return prev;
        const k = newS / prev.s;
        const tx = ax - (ax - prev.tx) * k;
        const ty = ay - (ay - prev.ty) * k;
        return clampZoom(newS, tx, ty, maxS);
      });
    };
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  }, [clampZoom]);

  // Desktop box-select. mousedown (handled on the canvas) arms a candidate;
  // once the pointer travels past REGION_DRAG_PX it becomes a drawn rectangle,
  // and mouseup then zooms to fit it and reports the zones inside. A press with
  // no travel is left untouched so the canvas onClick still toggles the lock.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag.active) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < REGION_DRAG_PX) {
          return;
        }
        drag.moved = true;
      }
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const r = wrapper.getBoundingClientRect();
      const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
      const x0 = clamp(Math.min(drag.startX, e.clientX) - r.left, r.width);
      const x1 = clamp(Math.max(drag.startX, e.clientX) - r.left, r.width);
      const y0 = clamp(Math.min(drag.startY, e.clientY) - r.top, r.height);
      const y1 = clamp(Math.max(drag.startY, e.clientY) - r.top, r.height);
      setDragRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    };

    const onUp = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag.active) return;
      drag.active = false;
      setDragRect(null);
      if (!drag.moved) return; // bare click → leave it for the canvas onClick
      suppressClickRef.current = true; // we dragged; swallow the trailing click
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 100); // safety net if the click never lands (mouseup left the canvas)

      const canvas = canvasRef.current;
      const wrapper = wrapperRef.current;
      if (!canvas || !wrapper) return;
      const cRect = canvas.getBoundingClientRect();
      const wRect = wrapper.getBoundingClientRect();

      // Box in client coords, clamped to the visible canvas.
      const bx0 = Math.max(Math.min(drag.startX, e.clientX), cRect.left);
      const bx1 = Math.min(Math.max(drag.startX, e.clientX), cRect.right);
      const by0 = Math.max(Math.min(drag.startY, e.clientY), cRect.top);
      const by1 = Math.min(Math.max(drag.startY, e.clientY), cRect.bottom);
      if (bx1 - bx0 < REGION_MIN_PX || by1 - by0 < REGION_MIN_PX) return;

      // → image-pixel rect (same mapping the canvas uses for zoneAt).
      const px0 = Math.max(0, Math.floor(((bx0 - cRect.left) / cRect.width) * result.width));
      const px1 = Math.min(result.width, Math.ceil(((bx1 - cRect.left) / cRect.width) * result.width));
      const py0 = Math.max(0, Math.floor(((by0 - cRect.top) / cRect.height) * result.height));
      const py1 = Math.min(result.height, Math.ceil(((by1 - cRect.top) / cRect.height) * result.height));

      const { width: W, data } = zoneIndexData;
      const seen = new Set<number>();
      for (let y = py0; y < py1; y++) {
        for (let x = px0; x < px1; x++) seen.add(data[(y * W + x) * 4]);
      }
      if (seen.size === 0) return;
      onRegionSelect(Array.from(seen).sort((a, b) => a - b));
      if (lockedZone !== null && !seen.has(lockedZone)) onLockedZoneChange(null);

      // Zoom to fit the box. A client point maps to the inner content's
      // unscaled CSS-px coord u via (clientX - wrapperLeft - tx) / s; transform
      // origin is 0 0, so re-centering is just translate = center - u*newS.
      const z = zoomRef.current;
      const u0 = (bx0 - wRect.left - z.tx) / z.s;
      const u1 = (bx1 - wRect.left - z.tx) / z.s;
      const v0 = (by0 - wRect.top - z.ty) / z.s;
      const v1 = (by1 - wRect.top - z.ty) / z.s;
      const bw = u1 - u0;
      const bh = v1 - v0;
      if (bw <= 0 || bh <= 0) return;
      // Min-fit so the entire box ends up inside the viewport; uncapped so a
      // small region can fully fill (the wheel cap doesn't apply to a deliberate
      // box-select). ZOOM_MIN still keeps no-op huge boxes from zooming out.
      const newS = Math.max(
        ZOOM_MIN,
        Math.min(wRect.width / bw, wRect.height / bh),
      );
      const newTx = wRect.width / 2 - ((u0 + u1) / 2) * newS;
      const newTy = wRect.height / 2 - ((v0 + v1) / 2) * newS;
      setZoomTransition(true);
      setZoom(clampZoom(newS, newTx, newTy, Number.POSITIVE_INFINITY));
      window.setTimeout(() => setZoomTransition(false), RESET_DURATION_MS + 20);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [result, zoneIndexData, lockedZone, clampZoom, onRegionSelect, onLockedZoneChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    let pressTimer: number | null = null;
    let startX = 0;
    let startY = 0;
    let inLoupe = false;
    let pickedZone: number | null = null;
    // Pinch baseline: capturing s/tx/ty at gesture start lets us derive each
    // frame's transform from the *original* finger positions, avoiding drift
    // that accumulates when each delta is applied to the previous frame.
    let pinch:
      | {
          dist: number;
          cx: number;
          cy: number;
          baseS: number;
          baseTx: number;
          baseTy: number;
        }
      | null = null;

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

    const loupeCenter = (fx: number, fy: number): [number, number] => {
      return [fx + LOUPE_OFFSET_X, fy + LOUPE_OFFSET_Y];
    };

    const drawLoupe = (fx: number, fy: number) => {
      const loupe = loupeRef.current;
      if (!loupe) return;
      const ctx = loupe.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const px = LOUPE_DIAMETER * dpr;
      if (loupe.width !== px) loupe.width = px;
      if (loupe.height !== px) loupe.height = px;

      const [lx, ly] = loupeCenter(fx, fy);
      const rect = canvas.getBoundingClientRect();
      const sx = ((lx - rect.left) / rect.width) * canvas.width;
      const sy = ((ly - rect.top) / rect.height) * canvas.height;
      const srcSize = LOUPE_DIAMETER / LOUPE_ZOOM;

      ctx.save();
      ctx.clearRect(0, 0, px, px);
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
      ctx.clip();
      // Nearest-neighbor preserves the posterized zone boundaries; smoothing
      // would blur the very edges the user is trying to target.
      ctx.imageSmoothingEnabled = false;
      // Backdrop matches the page bg so areas outside the image just look
      // like the page continues — keeps the dropoff legible instead of
      // reading as a black mask under the loupe.
      ctx.fillStyle = "#f5f0e8";
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

      loupe.style.left = `${lx - LOUPE_DIAMETER / 2}px`;
      loupe.style.top = `${ly - LOUPE_DIAMETER / 2}px`;
    };

    const enterLoupe = (fx: number, fy: number) => {
      inLoupe = true;
      // Position + paint the loupe BEFORE flipping opacity to 100, otherwise
      // the React rerender can show the canvas at its previous (or default
      // 0,0) left/top for one frame before drawLoupe runs in the next rAF.
      // On iPhone this read as a stray dot flashing at the screen corner.
      const [lx, ly] = loupeCenter(fx, fy);
      const z = zoneAtClient(lx, ly);
      pickedZone = z;
      onHoveredZoneChange(z);
      drawLoupe(fx, fy);
      setLoupeActive(true);
    };

    const cancelPress = () => {
      if (pressTimer !== null) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
    };
    const exitLoupe = () => {
      if (!inLoupe) return;
      inLoupe = false;
      setLoupeActive(false);
      onHoveredZoneChange(null);
      pickedZone = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      wasTouchRef.current = true;
      // Second finger lands → switch from any single-touch state into pinch.
      // We deliberately don't lock the zone the loupe was over: a deliberate
      // pinch shouldn't leave a stray selection from the moment-before state.
      if (e.touches.length === 2) {
        cancelPress();
        exitLoupe();
        setZoomTransition(false);
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const z = zoomRef.current;
        pinch = {
          dist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
          cx: (t1.clientX + t2.clientX) / 2,
          cy: (t1.clientY + t2.clientY) / 2,
          baseS: z.s,
          baseTx: z.tx,
          baseTy: z.ty,
        };
        return;
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        enterLoupe(startX, startY);
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (pinch && e.touches.length >= 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const cx = (t1.clientX + t2.clientX) / 2;
        const cy = (t1.clientY + t2.clientY) / 2;
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        if (pinch.dist === 0) return;
        const k = dist / pinch.dist;
        const newS = pinch.baseS * k;
        const rect = wrapper.getBoundingClientRect();
        // Anchor the original midpoint to wherever the current midpoint is —
        // this fuses zoom-around-anchor and 2-finger pan in a single update.
        const tx = cx - rect.left - (pinch.cx - rect.left - pinch.baseTx) * k;
        const ty = cy - rect.top - (pinch.cy - rect.top - pinch.baseTy) * k;
        // Mirror the wheel handler: allow whatever zoom was in effect at gesture
        // start (so pinching after a region zoom doesn't snap back to ZOOM_MAX).
        setZoom(clampZoom(newS, tx, ty, Math.max(ZOOM_MAX, pinch.baseS)));
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      if (pressTimer !== null) {
        if (Math.hypot(t.clientX - startX, t.clientY - startY) > MOVE_CANCEL_PX) {
          cancelPress();
        }
      }
      if (inLoupe) {
        // Need passive: false so this preventDefault actually suppresses scroll.
        e.preventDefault();
        const [lx, ly] = loupeCenter(t.clientX, t.clientY);
        const z = zoneAtClient(lx, ly);
        if (z !== pickedZone) {
          pickedZone = z;
          onHoveredZoneChange(z);
        }
        drawLoupe(t.clientX, t.clientY);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      // Tail of a pinch: keep wasTouchRef set briefly so the synthetic click
      // that fires after the last finger lifts can't re-trigger the
      // desktop lock-toggle path.
      if (pinch) {
        if (e.touches.length < 2) pinch = null;
        if (e.touches.length === 0) {
          window.setTimeout(() => {
            wasTouchRef.current = false;
          }, 400);
        }
        return;
      }
      cancelPress();
      if (inLoupe) {
        const captured = pickedZone;
        exitLoupe();
        if (captured !== null) onLockedZoneChange(captured);
      }
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
  }, [zoneIndexData, onHoveredZoneChange, onLockedZoneChange, clampZoom]);

  const ariaLabel =
    mode === "zones"
      ? "tonal-zone map of the uploaded reference; click a zone to lock its bracket"
      : "uploaded reference image; click a zone to lock its bracket";

  const isZoomed = zoom.s > 1.001;

  return (
    <div
      ref={wrapperRef}
      className="relative w-full overflow-hidden border border-[var(--border)]"
    >
      <div
        style={{
          transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})`,
          transformOrigin: "0 0",
          transition: zoomTransition
            ? `transform ${RESET_DURATION_MS}ms ${RESET_EASING}`
            : "none",
          willChange: "transform",
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={ariaLabel}
          onMouseDown={(e) => {
            if (e.button !== 0 || wasTouchRef.current) return;
            dragRef.current = {
              active: true,
              moved: false,
              startX: e.clientX,
              startY: e.clientY,
            };
            e.preventDefault(); // suppress text selection / native image drag
          }}
          onMouseMove={(e) => {
            if (dragRef.current.active || lockedZone !== null) return;
            onHoveredZoneChange(zoneAt(e));
          }}
          onMouseLeave={() => {
            if (dragRef.current.active || lockedZone !== null) return;
            onHoveredZoneChange(null);
          }}
          onClick={(e) => {
            if (wasTouchRef.current) return;
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
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
      </div>
      {dragRect && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-20"
          style={{
            left: dragRect.x,
            top: dragRect.y,
            width: dragRect.w,
            height: dragRect.h,
            border: `1.5px solid ${CORE_COLOR}`,
            boxShadow: `0 0 0 1.5px ${HALO_COLOR}, inset 0 0 0 1.5px ${HALO_COLOR}`,
          }}
        />
      )}
      {(isZoomed || regionActive) && (
        <button
          type="button"
          onClick={resetZoom}
          aria-label="reset zoom"
          className="absolute right-3 top-3 rounded-full border border-[var(--border)] bg-[var(--background)]/95 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[var(--foreground)] backdrop-blur transition-colors hover:text-[var(--accent)]"
        >
          reset zoom
        </button>
      )}
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
