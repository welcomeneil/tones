"use client";

type Props = {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  notan: boolean;
  onToggleNotan: () => void;
};

const VALUES = [3, 5, 7, 9, 11, 13, 15];

export function ValueCountPicker({
  value,
  onChange,
  disabled,
  notan,
  onToggleNotan,
}: Props) {
  const buttonsDisabled = disabled || notan;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
          values
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={onToggleNotan}
          aria-pressed={notan}
          style={{ WebkitTapHighlightColor: "transparent" }}
          className={`text-[10px] uppercase tracking-[0.2em] underline underline-offset-4 transition-[color,text-decoration-color] duration-200 ease-out ${
            notan
              ? "text-[var(--foreground)] decoration-solid decoration-[var(--foreground)]"
              : "text-[var(--muted)] decoration-dotted decoration-[var(--border)]"
          } ${
            disabled
              ? "cursor-not-allowed opacity-40"
              : "hover:text-[var(--foreground)] hover:decoration-[var(--muted)]"
          }`}
        >
          notan
        </button>
      </div>
      <div className="flex select-none gap-1">
        {VALUES.map((n) => {
          const active = !notan && value === n;
          return (
            <button
              key={n}
              type="button"
              disabled={buttonsDisabled}
              onClick={() => onChange(n)}
              style={{ WebkitTapHighlightColor: "transparent" }}
              className={`flex h-12 min-w-0 flex-1 items-center justify-center bg-[var(--border)] font-mono text-sm tabular-nums outline outline-1 -outline-offset-1 transition-[color,outline-color,background-color] duration-200 ease-out ${
                active
                  ? "text-[var(--foreground)] outline-[var(--foreground)]"
                  : "text-[var(--muted)] outline-transparent"
              } ${
                buttonsDisabled
                  ? "cursor-not-allowed opacity-40"
                  : "hover:text-[var(--foreground)] active:text-[var(--foreground)] active:outline-[var(--foreground)]/25"
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
