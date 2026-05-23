"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onFile: (file: File) => void;
};

export function DropZone({ onFile }: Props) {
  const [isOver, setIsOver] = useState(false);
  // Mobile-only reveal state. Desktop drives the tonal-staircase wipe off
  // :hover; on touch we set this on tap and clear it when the next pointer
  // lands outside the button so iOS sticky-hover can't strand it open.
  const [tapped, setTapped] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  };

  useEffect(() => {
    if (!tapped) return;
    const onDocDown = (e: PointerEvent) => {
      const btn = buttonRef.current;
      if (!btn) return;
      if (e.target instanceof Node && btn.contains(e.target)) return;
      setTapped(false);
    };
    document.addEventListener("pointerdown", onDocDown, true);
    return () => document.removeEventListener("pointerdown", onDocDown, true);
  }, [tapped]);

  return (
    <button
      ref={buttonRef}
      type="button"
      data-over={isOver}
      data-tapped={tapped}
      onClick={() => inputRef.current?.click()}
      onPointerDown={(e) => {
        if (e.pointerType === "touch") setTapped(true);
      }}
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
      className="dropzone flex h-full min-h-0 w-full flex-col items-center justify-center gap-3"
    >
      <p className="dropzone-label font-serif text-xl text-[var(--foreground)]">
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
