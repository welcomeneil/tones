"use client";

import { useRef, useState } from "react";

type Props = {
  onFile: (file: File) => void;
};

export function DropZone({ onFile }: Props) {
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  };

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`flex h-64 w-full flex-col items-center justify-center gap-3 border border-dashed transition-colors ${
        isOver
          ? "border-[var(--foreground)] bg-[var(--border)]/40"
          : "border-[var(--border)] hover:border-[var(--muted)]"
      }`}
    >
      <p className="font-serif text-xl italic text-[var(--foreground)]">
        drop an image, or click to choose
      </p>
      <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        jpg · png · webp
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </button>
  );
}
