import type { CoverPageJob } from "./cover-page-data";
import type { CompanySettings } from "./types";

export interface LayoutEnginePhoto {
  id: string;
  caption: string | null;
  takenAt: string | null;
  takenBy: string | null;
  width: number | null;
  height: number | null;
}

export interface LayoutEngineSection {
  title: string;
  description: string;
  photo_ids: string[];
}

export type PhotoOrientation = "portrait" | "landscape";

export interface PhotoSlot {
  photoId: string;
  number: number;
  caption: string | null;
  takenAt: string | null;
  takenBy: string | null;
  orientation: PhotoOrientation;
}

export type DocumentPage =
  | { kind: "cover" }
  | { kind: "photoPage"; sectionTitle: string; slots: PhotoSlot[] };

export interface BuildReportDocumentInput {
  job: CoverPageJob;
  companySettings: CompanySettings;
  sections: LayoutEngineSection[];
  photos: Record<string, LayoutEnginePhoto>;
  photosPerPage: number;
}

const SUPPORTED_PHOTOS_PER_PAGE = 2;

function computeOrientation(
  width: number | null,
  height: number | null,
): PhotoOrientation {
  if (width != null && height != null && width > height) return "landscape";
  return "portrait";
}

export function buildReportDocument(
  input: BuildReportDocumentInput,
): DocumentPage[] {
  const { sections, photos, photosPerPage } = input;
  const perPage =
    photosPerPage === SUPPORTED_PHOTOS_PER_PAGE
      ? photosPerPage
      : SUPPORTED_PHOTOS_PER_PAGE;

  const pages: DocumentPage[] = [{ kind: "cover" }];
  let runningNumber = 0;

  for (const section of sections) {
    const sectionPhotos = section.photo_ids
      .map((id) => photos[id])
      .filter((p): p is LayoutEnginePhoto => Boolean(p));

    if (sectionPhotos.length === 0) continue;

    const slots: PhotoSlot[] = sectionPhotos.map((p) => ({
      photoId: p.id,
      number: ++runningNumber,
      caption: p.caption,
      takenAt: p.takenAt,
      takenBy: p.takenBy,
      orientation: computeOrientation(p.width, p.height),
    }));

    for (let i = 0; i < slots.length; i += perPage) {
      pages.push({
        kind: "photoPage",
        sectionTitle: section.title,
        slots: slots.slice(i, i + perPage),
      });
    }
  }

  return pages;
}
