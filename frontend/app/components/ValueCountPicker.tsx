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
              style={{ WebkitTapHighlightColor: "transparent" }}
              className={`flex h-12 min-w-0 flex-1 items-center justify-center bg-[var(--border)] font-mono text-sm tabular-nums outline outline-1 -outline-offset-1 transition-[transform,color,outline-color,background-color] duration-100 ease-out ${
                active
                  ? "text-[var(--foreground)] outline-[var(--foreground)]"
                  : "text-[var(--muted)] outline-transparent"
              } ${
                disabled
                  ? "cursor-not-allowed opacity-40"
                  : "hover:text-[var(--foreground)] active:scale-[0.96] active:bg-[var(--muted)]/15 active:text-[var(--foreground)] active:outline-[var(--foreground)]/60"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
