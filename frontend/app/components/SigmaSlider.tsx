"use client";

type Props = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

export function SigmaSlider({ value, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <label
          htmlFor="sigma"
          className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]"
        >
          squint
        </label>
        <span className="font-mono text-xs tabular-nums text-[var(--foreground)]">
          σ {value.toFixed(1)}
        </span>
      </div>
      <input
        id="sigma"
        type="range"
        min={0.5}
        max={6.0}
        step={0.1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="tonal-slider w-full"
      />
    </div>
  );
}
