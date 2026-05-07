"use client";

import { useRef } from "react";

type Props = {
  palette: number[];
  selectedZone: number | null;
  lockedZone: number | null;
  onHoveredZoneChange: (zone: number | null) => void;
  onLockedZoneChange: (zone: number | null) => void;
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
  const slideRef = useRef({ active: false, moved: false });

  const zoneAt = (x: number, y: number): number | null => {
    const root = containerRef.current;
    if (!root) return null;
    const rect = root.getBoundingClientRect();
    // Vertical slack keeps tracking smooth if the finger drifts off the strip.
    const VERTICAL_SLACK = 32;
    if (x < rect.left || x > rect.right) return null;
    if (y < rect.top - VERTICAL_SLACK || y > rect.bottom + VERTICAL_SLACK) return null;
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

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") return;
    slideRef.current = { active: true, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    onHoveredZoneChange(zoneAt(e.clientX, e.clientY));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch" || !slideRef.current.active) return;
    slideRef.current.moved = true;
    onHoveredZoneChange(zoneAt(e.clientX, e.clientY));
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch" || !slideRef.current.active) return;
    slideRef.current.active = false;
    onHoveredZoneChange(null);
  };

  const handleClick = (idx: number) => {
    if (slideRef.current.moved) {
      slideRef.current.moved = false;
      return;
    }
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
            onMouseEnter={() => onHoveredZoneChange(idx)}
            onMouseLeave={() => onHoveredZoneChange(null)}
            onClick={() => handleClick(idx)}
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
