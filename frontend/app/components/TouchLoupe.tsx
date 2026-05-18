"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  sourceCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  zoneIndexData: ImageData;
  onHoveredZoneChange: (zone: number | null) => void;
  onLockedZoneChange: (zone: number | null) => void;
  disabled?: boolean;
};

const DIAMETER = 132;
const ZOOM = 2.5;
// Loupe sits top-left of the touch point. With radius 66 and a 12px gap,
// the loupe's center is offset by (-78, -78) from the finger — bottom-right
// corner of the glass lands at (touch.x - 12, touch.y - 12).
const GAP_PX = 12;
const OFFSET = -(DIAMETER / 2 + GAP_PX);
const LONG_PRESS_MS = 320;
const MOVE_CANCEL_PX = 12;

const HALO_COLOR = "#f5f0e8";
const CORE_COLOR = "#e63946";

export function TouchLoupe({
  sourceCanvasRef,
  zoneIndexData,
  onHoveredZoneChange,
  onLockedZoneChange,
  disabled,
}: Props) {
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);

  // SSR-safe portal: defer the createPortal call until after hydration so we
  // never touch document.body on the server. setState in effect is the
  // accepted pattern for this; nothing else surfaces "is the DOM ready".
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Keep latest disabled in a ref so the bound handlers see fresh state
  // without rebinding (rebinding mid-gesture drops events).
  const disabledRef = useRef(!!disabled);
  useEffect(() => {
    disabledRef.current = !!disabled;
  }, [disabled]);

  useEffect(() => {
    const source = sourceCanvasRef.current;
    if (!source) return;

    type Phase = "idle" | "pending" | "engaged";
    let phase: Phase = "idle";
    let pressTimer: number | null = null;
    let startX = 0;
    let startY = 0;
    let glassX = 0;
    let glassY = 0;
    let pickedZone: number | null = null;
    let rafId: number | null = null;
    let pendingTouch: { x: number; y: number } | null = null;

    const glassCenter = (cx: number, cy: number): [number, number] => {
      return [cx + OFFSET, cy + OFFSET];
    };

    const zoneAt = (clientX: number, clientY: number): number | null => {
      const rect = source.getBoundingClientRect();
      const x = Math.floor(
        ((clientX - rect.left) / rect.width) * zoneIndexData.width,
      );
      const y = Math.floor(
        ((clientY - rect.top) / rect.height) * zoneIndexData.height,
      );
      if (
        x < 0 ||
        y < 0 ||
        x >= zoneIndexData.width ||
        y >= zoneIndexData.height
      ) {
        return null;
      }
      return zoneIndexData.data[(y * zoneIndexData.width + x) * 4];
    };

    const paint = () => {
      rafId = null;
      const loupe = loupeRef.current;
      if (!loupe) return;
      const ctx = loupe.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const px = DIAMETER * dpr;
      if (loupe.width !== px) loupe.width = px;
      if (loupe.height !== px) loupe.height = px;

      // Map the glass center (client coords) to source-canvas pixel coords.
      // getBoundingClientRect already accounts for any ancestor transform.
      const rect = source.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const sx = ((glassX - rect.left) / rect.width) * source.width;
      const sy = ((glassY - rect.top) / rect.height) * source.height;
      // True visual magnification = ZOOM relative to the on-screen image,
      // regardless of how downscaled the source canvas is. (DIAMETER/ZOOM)
      // is the CSS-px square we want covered; multiplying by
      // (source.width/rect.width) converts CSS-px → source-px so drawImage
      // samples the right region. The earlier inline implementation skipped
      // this conversion and silently became ~7.7× on a 390px viewport.
      const srcSize = (DIAMETER / ZOOM) * (source.width / rect.width);

      ctx.save();
      ctx.clearRect(0, 0, px, px);
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = HALO_COLOR;
      ctx.fillRect(0, 0, px, px);
      ctx.drawImage(
        source,
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
      const arm = 7 * dpr;
      ctx.beginPath();
      ctx.moveTo(px / 2 - arm, px / 2);
      ctx.lineTo(px / 2 + arm, px / 2);
      ctx.moveTo(px / 2, px / 2 - arm);
      ctx.lineTo(px / 2, px / 2 + arm);
      ctx.stroke();

      loupe.style.left = `${glassX - DIAMETER / 2}px`;
      loupe.style.top = `${glassY - DIAMETER / 2}px`;
    };

    const requestPaint = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(paint);
    };

    const updateFromTouch = (clientX: number, clientY: number) => {
      const [gx, gy] = glassCenter(clientX, clientY);
      glassX = gx;
      glassY = gy;
      const z = zoneAt(gx, gy);
      if (z !== pickedZone) {
        pickedZone = z;
        onHoveredZoneChange(z);
      }
      requestPaint();
    };

    const clearTimer = () => {
      if (pressTimer !== null) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    const engage = (clientX: number, clientY: number) => {
      phase = "engaged";
      // Position-then-paint-then-show: write left/top and draw before flipping
      // opacity to 1 so the very first frame is never at (0,0).
      updateFromTouch(clientX, clientY);
      // Force synchronous paint of this frame so the canvas is correct when
      // React flips the opacity. The rAF in requestPaint is fine for follow-up
      // moves; the first frame benefits from immediate paint.
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      paint();
      setActive(true);
    };

    const disengage = (commit: boolean) => {
      if (phase !== "engaged") return;
      phase = "idle";
      setActive(false);
      if (commit && pickedZone !== null) {
        onLockedZoneChange(pickedZone);
      }
      onHoveredZoneChange(null);
      pickedZone = null;
    };

    const reset = () => {
      clearTimer();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingTouch = null;
      if (phase === "engaged") {
        phase = "idle";
        setActive(false);
        onHoveredZoneChange(null);
      } else {
        phase = "idle";
      }
      pickedZone = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (disabledRef.current) {
        reset();
        return;
      }
      // Any time a second finger lands we stand down — pinch belongs to the
      // parent. The first finger's pending press is cancelled.
      if (e.touches.length >= 2) {
        reset();
        return;
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      pendingTouch = { x: t.clientX, y: t.clientY };
      phase = "pending";
      clearTimer();
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        if (phase !== "pending" || !pendingTouch) return;
        engage(pendingTouch.x, pendingTouch.y);
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (disabledRef.current) {
        reset();
        return;
      }
      if (e.touches.length >= 2) {
        // Second finger snuck in mid-gesture → stand down for pinch.
        reset();
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      if (phase === "pending") {
        pendingTouch = { x: t.clientX, y: t.clientY };
        if (Math.hypot(t.clientX - startX, t.clientY - startY) > MOVE_CANCEL_PX) {
          clearTimer();
          phase = "idle";
          pendingTouch = null;
        }
        return;
      }
      if (phase === "engaged") {
        // passive: false on the listener — preventDefault actually blocks
        // the page from scrolling while the loupe is tracking the finger.
        e.preventDefault();
        updateFromTouch(t.clientX, t.clientY);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length >= 1) {
        // Still touching with another finger; pinch handler upstream owns it.
        return;
      }
      if (phase === "engaged") {
        disengage(true);
      } else if (phase === "pending") {
        clearTimer();
        phase = "idle";
        pendingTouch = null;
      }
    };

    const onTouchCancel = () => {
      reset();
    };

    source.addEventListener("touchstart", onTouchStart, { passive: true });
    source.addEventListener("touchmove", onTouchMove, { passive: false });
    source.addEventListener("touchend", onTouchEnd);
    source.addEventListener("touchcancel", onTouchCancel);

    return () => {
      clearTimer();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      source.removeEventListener("touchstart", onTouchStart);
      source.removeEventListener("touchmove", onTouchMove);
      source.removeEventListener("touchend", onTouchEnd);
      source.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [
    sourceCanvasRef,
    zoneIndexData,
    onHoveredZoneChange,
    onLockedZoneChange,
  ]);

  if (!mounted) return null;
  return createPortal(
    <canvas
      ref={loupeRef}
      aria-hidden="true"
      // left/top are written directly to the DOM in paint() — keep them out
      // of the React style prop so re-renders (e.g. opacity flip) don't
      // overwrite them.
      style={{
        width: DIAMETER,
        height: DIAMETER,
        position: "fixed",
        pointerEvents: "none",
        borderRadius: "50%",
        boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        opacity: active ? 1 : 0,
        transition: "opacity 120ms",
        zIndex: 9999,
      }}
    />,
    document.body,
  );
}
