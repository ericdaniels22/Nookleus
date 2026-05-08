// Retained as type fixture; no longer imported in production paths.
// Session A.5 wired the real org-scoped fetch via usePhotoTags
// (src/lib/mobile/use-photo-tags.ts) against the scratch Supabase
// project. Keeping this file makes the expected shape obvious for
// future Storybook stories or test fixtures.

import type { PhotoTag } from "@/lib/types";

export const MOCK_PHOTO_TAGS: PhotoTag[] = [
  {
    id: "mock-tag-before",
    name: "Before",
    color: "#dc2626",
    created_by: "mock",
    created_at: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "mock-tag-during",
    name: "During",
    color: "#f59e0b",
    created_by: "mock",
    created_at: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "mock-tag-after",
    name: "After",
    color: "#16a34a",
    created_by: "mock",
    created_at: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "mock-tag-damage",
    name: "Damage",
    color: "#7c3aed",
    created_by: "mock",
    created_at: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "mock-tag-equipment",
    name: "Equipment",
    color: "#0284c7",
    created_by: "mock",
    created_at: "2026-04-29T00:00:00.000Z",
  },
];
