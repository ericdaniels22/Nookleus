export interface ReportPhotoInput {
  id: string;
  caption: string | null;
  takenAt: string | null;
  takenBy: string | null;
  width: number | null;
  height: number | null;
  beforeAfterPairId?: string | null;
  beforeAfterRole?: "before" | "after" | null;
}

export interface ReportSectionInput {
  title: string;
  description: string | null;
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
  | { kind: "sectionDivider"; title: string; description: string | null }
  | { kind: "photoPage"; sectionTitle: string; slots: PhotoSlot[] }
  | {
      kind: "beforeAfterPair";
      sectionTitle: string;
      before: PhotoSlot;
      after: PhotoSlot;
    };

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

function makeSlot(photo: ReportPhotoInput, number: number): PhotoSlot {
  return {
    photoId: photo.id,
    number,
    caption: photo.caption,
    takenAt: photo.takenAt,
    takenBy: photo.takenBy,
    orientation: orientationOf(photo),
  };
}

export function buildReportDocument(
  args: BuildReportDocumentArgs,
): DocumentPage[] {
  const pages: DocumentPage[] = [{ kind: "cover" }];
  const bucketSize = 2;
  let runningNumber = 1;

  for (const section of args.sections) {
    pages.push({
      kind: "sectionDivider",
      title: section.title,
      description: section.description,
    });

    const sectionPhotos = section.photoIds
      .map((id) => args.photos[id])
      .filter((p): p is ReportPhotoInput => Boolean(p));

    // First pass: walk in order, emit beforeAfterPair pages for the first
    // two photos sharing any given before_after_pair_id within this section.
    // Extras (a third+ sharing the same id) and photos whose partner is
    // missing fall back to regular photoPage bucketing in document order.
    const pairConsumed = new Set<string>();
    const pairedByPhotoId = new Set<string>();

    type Item =
      | {
          kind: "pair";
          before: ReportPhotoInput;
          after: ReportPhotoInput;
          // Encounter order: the first photo of the pair encountered in the
          // section's photoIds traversal (used for numbering). The slot
          // (before/after) is assigned independently from `beforeAfterRole`.
          first: ReportPhotoInput;
          second: ReportPhotoInput;
        }
      | { kind: "single"; photo: ReportPhotoInput };
    const items: Item[] = [];

    for (let i = 0; i < sectionPhotos.length; i++) {
      const photo = sectionPhotos[i];
      if (pairedByPhotoId.has(photo.id)) continue;

      const pairId = photo.beforeAfterPairId;
      if (pairId && !pairConsumed.has(pairId)) {
        const partnerIndex = sectionPhotos.findIndex(
          (other, j) =>
            j > i &&
            other.beforeAfterPairId === pairId &&
            !pairedByPhotoId.has(other.id),
        );

        if (partnerIndex !== -1) {
          const partner = sectionPhotos[partnerIndex];
          // Assign before/after by role when available; otherwise fall back
          // to document order (the earlier-encountered photo is "before").
          const photoIsBefore =
            photo.beforeAfterRole === "after"
              ? false
              : partner.beforeAfterRole === "before"
                ? false
                : true;
          const beforePhoto = photoIsBefore ? photo : partner;
          const afterPhoto = photoIsBefore ? partner : photo;

          items.push({
            kind: "pair",
            before: beforePhoto,
            after: afterPhoto,
            first: photo,
            second: partner,
          });
          pairConsumed.add(pairId);
          pairedByPhotoId.add(photo.id);
          pairedByPhotoId.add(partner.id);
          continue;
        }
      }

      items.push({ kind: "single", photo });
    }

    // Second pass: emit pages. Pairs flush any in-progress photo bucket and
    // get their own page. Singles bucket two-per-page in document order.
    let singleBuffer: ReportPhotoInput[] = [];

    const flushSingles = () => {
      if (singleBuffer.length === 0) return;
      for (let i = 0; i < singleBuffer.length; i += bucketSize) {
        const bucket = singleBuffer.slice(i, i + bucketSize);
        pages.push({
          kind: "photoPage",
          sectionTitle: section.title,
          slots: bucket.map((p) => makeSlot(p, runningNumber++)),
        });
      }
      singleBuffer = [];
    };

    for (const item of items) {
      if (item.kind === "single") {
        singleBuffer.push(item.photo);
        continue;
      }
      flushSingles();
      // Number in encounter order, then map to the before/after slot.
      const firstNumber = runningNumber++;
      const secondNumber = runningNumber++;
      const numberFor = (p: ReportPhotoInput) =>
        p.id === item.first.id ? firstNumber : secondNumber;
      pages.push({
        kind: "beforeAfterPair",
        sectionTitle: section.title,
        before: makeSlot(item.before, numberFor(item.before)),
        after: makeSlot(item.after, numberFor(item.after)),
      });
    }

    flushSingles();
  }

  return pages;
}
