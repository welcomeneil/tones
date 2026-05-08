"use client";

import { useRef } from "react";

type Props = {
  palette: number[];
  selectedZone: number | null;
  lockedZone: number | null;
  onHoveredZoneChange: (zone: number | null) => void;
  onLockedZoneChange: (zone: number | null) => void;
};

// Distance the finger must travel before we consider the gesture a slide
// rather than a tap. Smaller than a single swatch so accidental drift never
// crosses into a neighbour but large enough to absorb finger jitter.
const SLIDE_THRESHOLD_PX = 8;
// Vertical tolerance for hit-testing during a slide — keeps tracking smooth
// if the finger drifts above or below the strip while moving horizontally.
const VERTICAL_SLACK_PX = 32;

type TouchState = {
  active: boolean;
  moved: boolean;
  pointerId: number;
  startX: number;
  startY: number;
};

const idleTouchState: TouchState = {
  active: false,
  moved: false,
  pointerId: -1,
  startX: 0,
  startY: 0,
};

export function PaletteStrip({
  palette,
  selectedZone,
  lockedZone,
  onHoveredZoneChange,
  onLockedZoneChange,
}: Props) {
  const n = palette.length;
  const containerRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<TouchState>({ ...idleTouchState });

  // Hit-test by horizontal proximity to swatch centers. Always returns the
  // nearest swatch when the finger is within the strip's bounds (with vertical
  // slack), so the inter-swatch gaps don't produce a transient null.
  const zoneAt = (x: number, y: number): number | null => {
    const root = containerRef.current;
    if (!root) return null;
    const rect = root.getBoundingClientRect();
    if (x < rect.left || x > rect.right) return null;
    if (y < rect.top - VERTICAL_SLACK_PX || y > rect.bottom + VERTICAL_SLACK_PX) {
      return null;
    }
    const buttons = root.querySelectorAll<HTMLElement>("[data-zone-idx]");
    let bestIdx: number | null = null;
    let bestDist = Infinity;
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      const dist = Math.abs(x - (r.left + r.right) / 2);
      if (dist < bestDist) {
        const idx = Number(btn.dataset.zoneIdx);
        if (Number.isInteger(idx)) {
          bestIdx = idx;
          bestDist = dist;
        }
      }
    }
    return bestIdx;
  };

  // ---------- Touch path (container) ----------
  // Slide updates hover; tap toggles lock. The lock toggle commits in
  // pointerup, not in the synthetic click, so iOS pointer-capture quirks
  // can't break it.

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") return;
    // First-finger-wins: ignore additional touches once a gesture is in flight.
    if (touchRef.current.active) return;
    touchRef.current = {
      active: true,
      moved: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") return;
    const s = touchRef.current;
    if (!s.active || e.pointerId !== s.pointerId) return;
    if (!s.moved) {
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      if (dx * dx + dy * dy < SLIDE_THRESHOLD_PX * SLIDE_THRESHOLD_PX) return;
      s.moved = true;
    }
    onHoveredZoneChange(zoneAt(e.clientX, e.clientY));
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") return;
    const s = touchRef.current;
    if (!s.active || e.pointerId !== s.pointerId) return;
    const wasSlide = s.moved;
    const startX = s.startX;
    const startY = s.startY;
    touchRef.current = { ...idleTouchState };
    if (wasSlide) {
      // Slide ended: drop the preview so selection falls back to the lock.
      onHoveredZoneChange(null);
      return;
    }
    // Tap: toggle lock for the swatch under the press point. Using the press
    // point (not the lift point) keeps fat-finger drift from selecting a
    // neighbour through the inter-swatch gap.
    const idx = zoneAt(startX, startY);
    if (idx === null) return;
    onLockedZoneChange(lockedZone === idx ? null : idx);
  };

  // ---------- Mouse / pen path (button) ----------
  // Standard hover semantics; click toggles lock. The pointerType check on
  // click filters out the synthetic compat-click that follows a touch tap.

  const handlePointerEnterButton = (
    e: React.PointerEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    if (e.pointerType === "touch") return;
    onHoveredZoneChange(idx);
  };

  const handlePointerLeaveButton = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "touch") return;
    onHoveredZoneChange(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>, idx: number) => {
    // Modern browsers dispatch click as a PointerEvent and expose pointerType
    // on the native event. Synthetic clicks from touch report "touch" — those
    // are already handled by handlePointerEnd, so ignore them here.
    const native = e.nativeEvent as MouseEvent & { pointerType?: string };
    if (native.pointerType === "touch") return;
    onLockedZoneChange(lockedZone === idx ? null : idx);
  };

  return (
    <div
      ref={containerRef}
      className="flex select-none gap-1"
      style={{
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        WebkitTapHighlightColor: "transparent",
        touchAction: "none",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {palette.map((luminosity, idx) => {
        const active = selectedZone === idx;
        const locked = lockedZone === idx;
        const dimmed = selectedZone !== null && !active;
        const labelLight = luminosity > 140;
        const fullLabel = `V${idx + 1}/${n}`;
        const shortLabel = String(idx + 1);
        const labelClass = `font-mono tabular-nums leading-none transition-opacity ${
          active ? "opacity-100" : "opacity-60 group-hover:opacity-100"
        }`;
        const labelStyle = { color: labelLight ? "#1a1a1a" : "#f5f0e8" };
        return (
          <button
            key={idx}
            type="button"
            data-zone-idx={idx}
            onPointerEnter={(e) => handlePointerEnterButton(e, idx)}
            onPointerLeave={handlePointerLeaveButton}
            onClick={(e) => handleClick(e, idx)}
            className={`group relative flex h-12 min-w-0 flex-1 items-end justify-center pb-1 transition-opacity duration-500 ease-in-out ${
              dimmed ? "opacity-50" : "opacity-100"
            }`}
            style={{
              backgroundColor: `rgb(${luminosity}, ${luminosity}, ${luminosity})`,
              outline: active
                ? "1px solid var(--foreground)"
                : locked
                  ? "1px dashed var(--foreground)"
                  : "none",
            }}
            title={`${fullLabel} · luminosity ${luminosity}`}
          >
            <span className={`${labelClass} text-[8px] sm:hidden`} style={labelStyle}>
              {shortLabel}
            </span>
            <span
              className={`${labelClass} hidden text-[10px] sm:inline`}
              style={labelStyle}
            >
              {fullLabel}
            </span>
          </button>
        );
      })}
    </div>
  );
}
