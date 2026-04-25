"use client";

export type AlgoMode = "targeted" | "auto";

type Props = {
  value: AlgoMode;
  onChange: (value: AlgoMode) => void;
  disabled?: boolean;
};

const MODES: { key: AlgoMode; label: string }[] = [
  { key: "targeted", label: "targeted" },
  { key: "auto", label: "auto" },
];

export function AlgoToggle({ value, onChange, disabled }: Props) {
  return (
    <div className="flex items-baseline gap-6">
      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        mode
      </span>
      <div className="flex gap-4">
        {MODES.map((m) => {
          const active = value === m.key;
          return (
            <button
              key={m.key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(m.key)}
              className={`text-xs tracking-wide transition-colors ${
                active
                  ? "text-[var(--foreground)] underline underline-offset-4"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
