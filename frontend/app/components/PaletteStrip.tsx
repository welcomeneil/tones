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
        const label = `V${idx + 1}/${n}`;
        return (
          <button
            key={idx}
            type="button"
            onMouseEnter={() => onHoveredZoneChange(idx)}
            onMouseLeave={() => onHoveredZoneChange(null)}
            onClick={() => onLockedZoneChange(locked ? null : idx)}
            className={`group relative flex h-12 flex-1 origin-bottom items-end justify-center pb-1 transition-transform duration-200 ease-out ${
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
            title={`${label} · luminosity ${luminosity}`}
          >
            <span
              className={`font-mono text-[10px] tabular-nums leading-none transition-opacity ${
                active ? "scale-y-[0.926] opacity-100" : "opacity-60 group-hover:opacity-100"
              }`}
              style={{ color: labelLight ? "#1a1a1a" : "#f5f0e8" }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
