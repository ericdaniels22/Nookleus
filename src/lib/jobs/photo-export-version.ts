// Issue #518 — the pure rule for which version of a Photo an export acts on and
// what the exported file is named. The "displayed version" is the annotated
// image when drawings exist, otherwise the original (the same rule the viewer
// shows). Kept free of React/DOM so the version + filename choice lives in one
// tested place; the viewer's Share / Save to device entries and the platform
// share/download plumbing read this.

import type { Photo } from "@/lib/types";
import { photoUrl, type PhotoUrlSource } from "./photo-url";

/** What an export does with the chosen version — drives only the filename. */
export type ExportIntent = "share" | "save" | "duplicate";

export interface ExportVersion {
  /** Fetchable URL of the version to export (the displayed image). */
  url: string;
  /** Human-meaningful download filename; extension matches the exported file. */
  filename: string;
}

/** The subset of a Photo the export rule reads. */
export type ExportablePhoto = Pick<Photo, "caption"> & PhotoUrlSource;

export function exportVersion(
  photo: ExportablePhoto,
  supabaseUrl: string,
  intent: ExportIntent,
): ExportVersion {
  const url = photoUrl(photo, supabaseUrl, "full");
  // Extension follows the exported version: the annotation render is a PNG even
  // when the original was a JPG, so read it off the displayed path.
  const displayedPath = photo.annotated_path || photo.storage_path;
  const ext = displayedPath.split(".").pop() ?? "jpg";
  // Friendly stem: the caption when one is set, otherwise the original file's
  // own name — never the "-annotated" render's — so a drawn-on Photo still
  // exports under its original name.
  const caption = photo.caption?.trim();
  const base = caption ? sanitizeFilename(caption) : basename(photo.storage_path);
  // A duplicate is a new file alongside the original, so it carries a distinct
  // name; share / save export the displayed version under its own name.
  const stem = intent === "duplicate" ? `${base} copy` : base;
  return { url, filename: `${stem}.${ext}` };
}

/**
 * Fold a caption into a filesystem-safe filename stem by dropping the characters
 * no OS allows in a name. Unlike the contract PDF rule it keeps non-ASCII —
 * `<a download>` and Web Share both carry UTF-8 names, so an accented caption
 * survives intact.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

/** The file's own name within its storage path, with any extension dropped. */
function basename(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
