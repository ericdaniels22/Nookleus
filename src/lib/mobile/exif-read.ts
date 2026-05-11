import exifr from "exifr";

export interface PhotoDimensions {
  width: number;
  height: number;
  orientation: number;
}

const FALLBACK: PhotoDimensions = { width: 0, height: 0, orientation: 1 };

export async function readDimensions(blob: Blob): Promise<PhotoDimensions> {
  try {
    const buf = await blob.arrayBuffer();
    const meta = await exifr.parse(buf, {
      pick: ["ImageWidth", "ImageHeight", "Orientation",
             "PixelXDimension", "PixelYDimension",
             "ExifImageWidth", "ExifImageHeight"],
    });
    if (!meta) return FALLBACK;
    const width =
      meta.ExifImageWidth ?? meta.PixelXDimension ?? meta.ImageWidth ?? 0;
    const height =
      meta.ExifImageHeight ?? meta.PixelYDimension ?? meta.ImageHeight ?? 0;
    const orientation = meta.Orientation ?? 1;
    return { width, height, orientation };
  } catch {
    return FALLBACK;
  }
}
