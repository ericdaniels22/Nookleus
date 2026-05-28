export interface ReportPhotoInput {
  id: string;
  caption: string | null;
  takenAt: string | null;
  takenBy: string | null;
  width: number | null;
  height: number | null;
}

export interface ReportSectionInput {
  title: string;
  photoIds: string[];
}

export interface PhotoSlot {
  photoId: string;
  number: number;
  caption: string | null;
  takenAt: string | null;
  takenBy: string | null;
  orientation: "portrait" | "landscape";
}

export type DocumentPage =
  | { kind: "cover" }
  | { kind: "photoPage"; sectionTitle: string; slots: PhotoSlot[] };

export interface BuildReportDocumentArgs {
  sections: ReportSectionInput[];
  photos: Record<string, ReportPhotoInput>;
  photosPerPage: number;
}

function orientationOf(photo: ReportPhotoInput): "portrait" | "landscape" {
  if (photo.width != null && photo.height != null && photo.width > photo.height) {
    return "landscape";
  }
  return "portrait";
}

export function buildReportDocument(
  args: BuildReportDocumentArgs,
): DocumentPage[] {
  const pages: DocumentPage[] = [{ kind: "cover" }];
  const bucketSize = 2;
  let runningNumber = 1;

  for (const section of args.sections) {
    const sectionPhotos = section.photoIds
      .map((id) => args.photos[id])
      .filter((p): p is ReportPhotoInput => Boolean(p));

    for (let i = 0; i < sectionPhotos.length; i += bucketSize) {
      const bucket = sectionPhotos.slice(i, i + bucketSize);
      const slots: PhotoSlot[] = bucket.map((photo) => ({
        photoId: photo.id,
        number: runningNumber++,
        caption: photo.caption,
        takenAt: photo.takenAt,
        takenBy: photo.takenBy,
        orientation: orientationOf(photo),
      }));
      pages.push({ kind: "photoPage", sectionTitle: section.title, slots });
    }
  }

  return pages;
}
