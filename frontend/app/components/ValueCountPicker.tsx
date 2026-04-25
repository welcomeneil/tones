"use client";

import { useState } from "react";

type Props = {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
};

const BASE = [3, 5, 7, 9];
const MORE = [11, 13, 15];

export function ValueCountPicker({ value, onChange, disabled }: Props) {
  const [expanded, setExpanded] = useState(MORE.includes(value));
  const options = expanded ? [...BASE, ...MORE] : BASE;

  return (
    <div className="flex items-baseline gap-6">
      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        values
      </span>
      <div className="flex items-baseline gap-3">
        {options.map((v) => {
          const active = value === v;
          return (
            <button
              key={v}
              type="button"
              disabled={disabled}
              onClick={() => onChange(v)}
              className={`font-mono text-sm tabular-nums transition-colors ${
                active
                  ? "text-[var(--foreground)] underline underline-offset-4"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
            >
              {v}
            </button>
          );
        })}
        {!expanded && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setExpanded(true)}
            className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            more
          </button>
        )}
      </div>
    </div>
  );
}
