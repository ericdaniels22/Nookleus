import exifr from "exifr";

export interface PhotoDimensions {
  width: number;
  height: number;
  orientation: number;
}

const FALLBACK: PhotoDimensions = { width: 0, height: 0, orientation: 1 };

// The EXIF capture timestamp, or null when the file carries none (screenshots,
// canvas re-encodes, videos). exifr returns it as local wall-clock time, which
// is what date-grouping wants. Upload-time fallbacks (lastModified, now) are
// the caller's business — the backfill needs the unvarnished EXIF answer.
export async function readTakenAt(blob: Blob): Promise<Date | null> {
  try {
    const buf = await blob.arrayBuffer();
    const meta = await exifr.parse(buf, {
      pick: ["DateTimeOriginal", "CreateDate"],
    });
    const date = meta?.DateTimeOriginal ?? meta?.CreateDate;
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

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
