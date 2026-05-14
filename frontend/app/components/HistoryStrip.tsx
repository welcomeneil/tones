"use client";

import { useEffect, useRef } from "react";

export type HistoryThumbEntry = {
  id: string;
  filename: string;
  bitmap: ImageBitmap | null;
};

type Props = {
  entries: readonly HistoryThumbEntry[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
};

const THUMB_W = 56;
const THUMB_H = 56;

export function HistoryStrip({ entries, currentId, onSelect, onRemove }: Props) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        session · {entries.length} {entries.length === 1 ? "image" : "images"}
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {entries.map((entry) => (
          <HistoryThumb
            key={entry.id}
            entry={entry}
            active={entry.id === currentId}
            onSelect={() => onSelect(entry.id)}
            onRemove={() => onRemove(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}

function HistoryThumb({
  entry,
  active,
  onSelect,
  onRemove,
}: {
  entry: HistoryThumbEntry;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const bitmap = entry.bitmap;
    if (!canvas || !bitmap) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = THUMB_W * dpr;
    canvas.height = THUMB_H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Center-crop cover fit so all thumbs are square regardless of source ratio.
    const srcAR = bitmap.width / bitmap.height;
    const dstAR = THUMB_W / THUMB_H;
    let sx: number, sy: number, sw: number, sh: number;
    if (srcAR > dstAR) {
      sh = bitmap.height;
      sw = bitmap.height * dstAR;
      sx = (bitmap.width - sw) / 2;
      sy = 0;
    } else {
      sw = bitmap.width;
      sh = bitmap.width / dstAR;
      sx = 0;
      sy = (bitmap.height - sh) / 2;
    }
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }, [entry.bitmap]);

  return (
    <div
      className="group relative flex-shrink-0"
      style={{ width: THUMB_W, height: THUMB_H }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active}
        title={entry.filename}
        className={`block h-full w-full overflow-hidden border transition-colors ${
          active
            ? "border-[var(--foreground)]"
            : "border-[var(--border)] hover:border-[var(--muted)]"
        }`}
      >
        {entry.bitmap ? (
          <canvas
            ref={canvasRef}
            style={{ width: THUMB_W, height: THUMB_H }}
            className="block"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[9px] uppercase tracking-[0.15em] text-[var(--muted)]">
            …
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`remove ${entry.filename} from session`}
        className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--background)] text-[10px] leading-none text-[var(--muted)] hover:text-[var(--foreground)] group-hover:flex"
      >
        ×
      </button>
    </div>
  );
}
