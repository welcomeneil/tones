"use client";

type Props = {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
};

const VALUES = [3, 5, 7, 9, 11, 13, 15];

export function ValueCountPicker({ value, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        values
      </span>
      <div className="flex select-none gap-1">
        {VALUES.map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => onChange(n)}
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
