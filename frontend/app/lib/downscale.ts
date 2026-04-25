const MAX_EDGE = 1200;
const QUALITY = 0.85;

export type DownscaleResult = {
  blob: Blob;
  bitmap: ImageBitmap;
};

export async function downscaleImage(file: File): Promise<DownscaleResult> {
  const source = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.drawImage(source, 0, 0, width, height);
  source.close();

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY });
  const bitmap = await createImageBitmap(blob);
  return { blob, bitmap };
}
