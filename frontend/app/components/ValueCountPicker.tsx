"use client";

import { useRef } from "react";

type Props = {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
};

const VALUES = [3, 5, 7, 9, 11, 13, 15];
const SLIDE_THRESHOLD_PX = 6;

export function ValueCountPicker({ value, onChange, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastN: value,
    suppressClick: false,
  });

  const valueAt = (x: number, y: number): number | null => {
    const root = containerRef.current;
    if (!root) return null;
    const rect = root.getBoundingClientRect();
    // Vertical slack mirrors PaletteStrip — keeps tracking smooth if the
    // finger drifts off the strip while sliding.
    const VERTICAL_SLACK = 32;
    if (x < rect.left || x > rect.right) return null;
    if (y < rect.top - VERTICAL_SLACK || y > rect.bottom + VERTICAL_SLACK) return null;
    const tiles = root.querySelectorAll<HTMLElement>("[data-n-value]");
    let bestN: number | null = null;
    let bestDist = Infinity;
    for (const t of tiles) {
      const r = t.getBoundingClientRect();
      const dist = Math.abs(x - (r.left + r.right) / 2);
      if (dist < bestDist) {
        const n = Number(t.dataset.nValue);
        if (Number.isInteger(n)) {
          bestN = n;
          bestDist = dist;
        }
      }
    }
    return bestN;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch" || disabled) return;
    slideRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      lastN: value,
      suppressClick: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch" || !slideRef.current.active) return;
    if (!slideRef.current.moved) {
      const dx = e.clientX - slideRef.current.startX;
      const dy = e.clientY - slideRef.current.startY;
      if (dx * dx + dy * dy < SLIDE_THRESHOLD_PX * SLIDE_THRESHOLD_PX) return;
      slideRef.current.moved = true;
    }
    const n = valueAt(e.clientX, e.clientY);
    if (n !== null && n !== slideRef.current.lastN) {
      slideRef.current.lastN = n;
      onChange(n);
    }
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch" || !slideRef.current.active) return;
    slideRef.current.active = false;
    if (e.type === "pointerup") {
      const n = valueAt(e.clientX, e.clientY);
      if (n !== null && n !== slideRef.current.lastN) onChange(n);
    }
    // Pointer capture swallows the synthetic click on touch in some browsers
    // and emits it in others — gate the click handler explicitly so a slide
    // never re-fires onChange after release.
    slideRef.current.suppressClick = true;
  };

  const handleClick = (n: number) => {
    if (slideRef.current.suppressClick) {
      slideRef.current.suppressClick = false;
      return;
    }
    if (!disabled) onChange(n);
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        values
      </span>
      <div
        ref={containerRef}
        className="flex select-none gap-1"
        style={{
          WebkitTouchCallout: "none",
          WebkitUserSelect: "none",
          WebkitTapHighlightColor: "transparent",
          touchAction: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {VALUES.map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              data-n-value={n}
              disabled={disabled}
              onClick={() => handleClick(n)}
              className={`flex h-12 min-w-0 flex-1 items-center justify-center font-mono text-sm tabular-nums transition-opacity ${
                active ? "text-[var(--foreground)]" : "text-[var(--muted)]"
              } ${disabled ? "cursor-not-allowed opacity-40" : "hover:text-[var(--foreground)]"}`}
              style={{
                backgroundColor: "var(--border)",
                outline: active ? "1px solid var(--foreground)" : "none",
                outlineOffset: "-1px",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
