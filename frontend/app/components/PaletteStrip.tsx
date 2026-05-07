"use client";

import { useRef } from "react";

type Props = {
  palette: number[];
  selectedZone: number | null;
  lockedZone: number | null;
  onHoveredZoneChange: (zone: number | null) => void;
  onLockedZoneChange: (zone: number | null) => void;
};

type TouchState = {
  active: boolean;
  startIdx: number | null;
  moved: boolean;
};

export function PaletteStrip({
  palette,
  selectedZone,
  lockedZone,
  onHoveredZoneChange,
  onLockedZoneChange,
}: Props) {
  const n = palette.length;
  const stateRef = useRef<TouchState>({
    active: false,
    startIdx: null,
    moved: false,
  });

  const idxFromPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y);
    const btn = el?.closest<HTMLElement>("[data-zone-idx]");
    if (!btn) return null;
    const v = btn.dataset.zoneIdx;
    return v === undefined ? null : Number(v);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    // Suppress the synthetic click that would otherwise fire after touch tap;
    // we handle lock-toggle ourselves in onPointerUp so slides don't lock.
    e.preventDefault();
    const idx = idxFromPoint(e.clientX, e.clientY);
    stateRef.current = { active: true, startIdx: idx, moved: false };
    if (idx !== null) onHoveredZoneChange(idx);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    const s = stateRef.current;
    if (!s.active) return;
    const idx = idxFromPoint(e.clientX, e.clientY);
    if (idx !== s.startIdx) s.moved = true;
    onHoveredZoneChange(idx);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    const s = stateRef.current;
    if (!s.active) return;
    const idx = idxFromPoint(e.clientX, e.clientY);
    if (!s.moved && idx !== null && idx === s.startIdx) {
      onLockedZoneChange(lockedZone === idx ? null : idx);
    }
    onHoveredZoneChange(null);
    stateRef.current = { active: false, startIdx: null, moved: false };
  };

  return (
    <div
      className="flex touch-none gap-1"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {palette.map((luminosity, idx) => {
        const active = selectedZone === idx;
        const locked = lockedZone === idx;
        const dimmed = selectedZone !== null && !active;
        const labelLight = luminosity > 140;
        const fullLabel = `V${idx + 1}/${n}`;
        const shortLabel = String(idx + 1);
        const labelClass = `font-mono tabular-nums leading-none transition-opacity ${
          active ? "scale-y-[0.926] opacity-100" : "opacity-60 group-hover:opacity-100"
        }`;
        const labelStyle = { color: labelLight ? "#1a1a1a" : "#f5f0e8" };
        return (
          <button
            key={idx}
            type="button"
            data-zone-idx={idx}
            onMouseEnter={() => onHoveredZoneChange(idx)}
            onMouseLeave={() => onHoveredZoneChange(null)}
            onClick={(e) => {
              if (e.detail === 0) {
                // Keyboard activation (Enter/Space) — toggle lock.
                onLockedZoneChange(locked ? null : idx);
                return;
              }
              // Mouse click — toggle lock. Touch taps are handled in onPointerUp.
              if ((e.nativeEvent as PointerEvent).pointerType !== "touch") {
                onLockedZoneChange(locked ? null : idx);
              }
            }}
            className={`group relative flex h-12 min-w-0 flex-1 origin-bottom items-end justify-center pb-1 transition-[transform,opacity] duration-200 ease-out ${
              active ? "scale-y-[1.08]" : ""
            } ${dimmed ? "opacity-30" : "opacity-100"}`}
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
