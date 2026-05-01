"use client";

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
  return (
    <div className="flex gap-1">
      {palette.map((luminosity, idx) => {
        const active = selectedZone === idx;
        const locked = lockedZone === idx;
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
            onMouseEnter={() => onHoveredZoneChange(idx)}
            onMouseLeave={() => onHoveredZoneChange(null)}
            onClick={() => onLockedZoneChange(locked ? null : idx)}
            className={`group relative flex h-12 min-w-0 flex-1 origin-bottom items-end justify-center pb-1 transition-transform duration-200 ease-out ${
              active ? "scale-y-[1.08]" : ""
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
