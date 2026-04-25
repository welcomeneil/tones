"use client";

import type { RenderMode } from "../lib/types";

type Props = {
  value: RenderMode;
  onChange: (value: RenderMode) => void;
  disabled?: boolean;
};

const MODES: { key: RenderMode; label: string }[] = [
  { key: "zones", label: "zones" },
  { key: "reference", label: "reference" },
];

export function ModeToggle({ value, onChange, disabled }: Props) {
  return (
    <div className="flex items-baseline gap-6">
      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        view
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
