"use client";

import { useEffect, useRef, useState } from "react";
import type { AnalyzeResult, RenderMode } from "../lib/types";

type Props = {
  result: AnalyzeResult;
  referenceBitmap: ImageBitmap;
  mode: RenderMode;
  selectedZone: number | null;
  lockedZone: number | null;
  onHoveredZoneChange: (zone: number | null) => void;
  onLockedZoneChange: (zone: number | null) => void;
};

// Near-black silhouette stroke (matches --foreground in globals.css).
const OUTLINE_RGB: [number, number, number] = [0x1a, 0x1a, 0x1a];

function base64ToBlob(b64: string, type: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function AnalyzedCanvas({
  result,
  referenceBitmap,
  mode,
  selectedZone,
  lockedZone,
  onHoveredZoneChange,
  onLockedZoneChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoneMap, setZoneMap] = useState<ImageBitmap | null>(null);
  const [zoneIndexData, setZoneIndexData] = useState<ImageData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const flatBlob = base64ToBlob(result.zoneMapPng, "image/png");
    const indexBlob = base64ToBlob(result.zoneIndexPng, "image/png");
    Promise.all([createImageBitmap(flatBlob), createImageBitmap(indexBlob)]).then(
      ([flat, index]) => {
        if (cancelled) {
          flat.close();
          index.close();
          return;
        }
        const offscreen = new OffscreenCanvas(result.width, result.height);
        const ctx = offscreen.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(index, 0, 0);
        const data = ctx.getImageData(0, 0, result.width, result.height);
        index.close();
        if (cancelled) {
          flat.close();
          return;
        }
        setZoneMap(flat);
        setZoneIndexData(data);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [result]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !zoneMap) return;
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (mode === "zones") {
      ctx.drawImage(zoneMap, 0, 0);
    } else {
      ctx.drawImage(referenceBitmap, 0, 0, result.width, result.height);
    }

    if (selectedZone !== null && zoneIndexData) {
      drawSilhouetteOutline(ctx, zoneIndexData, selectedZone);
    }
  }, [zoneMap, mode, referenceBitmap, result, selectedZone, zoneIndexData]);

  const zoneAt = (e: React.MouseEvent<HTMLCanvasElement>): number | null => {
    const canvas = canvasRef.current;
    if (!canvas || !zoneIndexData) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * zoneIndexData.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * zoneIndexData.height);
    if (x < 0 || y < 0 || x >= zoneIndexData.width || y >= zoneIndexData.height) {
      return null;
    }
    const idx = (y * zoneIndexData.width + x) * 4;
    return zoneIndexData.data[idx];
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={(e) => onHoveredZoneChange(zoneAt(e))}
      onMouseLeave={() => onHoveredZoneChange(null)}
      onClick={(e) => {
        const z = zoneAt(e);
        if (z === null) return;
        onLockedZoneChange(lockedZone === z ? null : z);
      }}
      className="h-auto w-full cursor-crosshair border border-[var(--border)]"
    />
  );
}

// Paints a 2px dark stroke along the boundary of `selected` within the image.
// An image-boundary neighbor counts as "different" so zones that touch the
// edge of the frame still get closed outlines.
function drawSilhouetteOutline(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  zoneIndexData: ImageData,
  selected: number,
) {
  const { width, height, data: zi } = zoneIndexData;
  const edge = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pi = y * width + x;
      if (zi[pi * 4] !== selected) continue;
      const left = x > 0 ? zi[(pi - 1) * 4] : -1;
      const right = x < width - 1 ? zi[(pi + 1) * 4] : -1;
      const up = y > 0 ? zi[(pi - width) * 4] : -1;
      const down = y < height - 1 ? zi[(pi + width) * 4] : -1;
      if (
        left !== selected ||
        right !== selected ||
        up !== selected ||
        down !== selected
      ) {
        edge[pi] = 1;
      }
    }
  }

  // Dilate edge mask by 1 pixel → 2px stroke width.
  const stroke = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pi = y * width + x;
      if (edge[pi]) {
        stroke[pi] = 1;
        continue;
      }
      if (
        (x > 0 && edge[pi - 1]) ||
        (x < width - 1 && edge[pi + 1]) ||
        (y > 0 && edge[pi - width]) ||
        (y < height - 1 && edge[pi + width])
      ) {
        stroke[pi] = 1;
      }
    }
  }

  const frame = ctx.getImageData(0, 0, width, height);
  const d = frame.data;
  for (let pi = 0; pi < stroke.length; pi++) {
    if (!stroke[pi]) continue;
    const i = pi * 4;
    d[i] = OUTLINE_RGB[0];
    d[i + 1] = OUTLINE_RGB[1];
    d[i + 2] = OUTLINE_RGB[2];
    d[i + 3] = 255;
  }
  ctx.putImageData(frame, 0, 0);
}
