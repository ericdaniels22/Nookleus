// Backfill photos.taken_at for rows uploaded before the column became
// always-populated (#622). Going forward every upload stamps taken_at
// (mobile camera at shutter time, web/camera-roll from EXIF with
// lastModified/now fallbacks); this script makes the column total for the
// historical rows so date filters and grouping never miss them.
//
// Per row where taken_at IS NULL, in order:
//   1. Videos: taken_at = created_at (exifr can't read video containers).
//   2. Download the primary object, read EXIF DateTimeOriginal/CreateDate.
//   3. No date there? Try the `-original` backup the annotator/cropper
//      writes before re-encoding (canvas re-encodes strip EXIF).
//   4. Still nothing (screenshots, stripped uploads): taken_at = created_at.
//
// EXIF dates carry no timezone — exifr reads them as local wall-clock time,
// so run this on a machine in the company's home timezone.
//
// Idempotent: only touches rows where taken_at IS NULL, and the UPDATE
// re-checks that guard so a concurrently-stamped row is never overwritten.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-photo-taken-at.ts             (dry run)
//   npx tsx --env-file=.env.local scripts/backfill-photo-taken-at.ts --execute
//
// Exits non-zero if any row fails; rerun to retry just the stragglers.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { readTakenAt } from "../src/lib/mobile/exif-read";

const EXECUTE = process.argv.includes("--execute");

type PhotoRow = {
  id: string;
  storage_path: string;
  media_type: string;
  created_at: string;
};

type Source = "exif" | "exif-backup" | "created_at";

async function downloadAndRead(
  supa: SupabaseClient,
  path: string,
): Promise<Date | null> {
  const { data, error } = await supa.storage.from("photos").download(path);
  if (error || !data) return null;
  return readTakenAt(data);
}

// The capture date and where it came from. Falls through the chain in the
// header comment; created_at is the floor, so this never returns nothing.
async function resolveTakenAt(
  supa: SupabaseClient,
  row: PhotoRow,
): Promise<{ takenAt: Date; source: Source }> {
  if (row.media_type === "photo") {
    const primary = await downloadAndRead(supa, row.storage_path);
    if (primary) return { takenAt: primary, source: "exif" };

    const backupPath = row.storage_path.replace(/\.[^.]+$/, "-original$&");
    const backup = await downloadAndRead(supa, backupPath);
    if (backup) return { takenAt: backup, source: "exif-backup" };
  }
  return { takenAt: new Date(row.created_at), source: "created_at" };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local");

  const supa = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`taken_at backfill${EXECUTE ? "" : "  (DRY RUN — pass --execute to write)"}`);

  const { data: rows, error } = await supa
    .from("photos")
    .select("id, storage_path, media_type, created_at")
    .is("taken_at", null)
    .order("created_at", { ascending: true })
    .returns<PhotoRow[]>();
  if (error) throw new Error(`select photos: ${error.message}`);

  console.log(`${rows.length} rows with taken_at IS NULL\n`);

  const counts: Record<Source, number> = { exif: 0, "exif-backup": 0, created_at: 0 };
  let failed = 0;

  for (const row of rows) {
    try {
      const { takenAt, source } = await resolveTakenAt(supa, row);
      counts[source]++;
      console.log(
        `  ${row.id}  ${source.padEnd(11)}  ${takenAt.toISOString()}  ${row.storage_path}`,
      );

      if (!EXECUTE) continue;
      const { error: updErr } = await supa
        .from("photos")
        .update({ taken_at: takenAt.toISOString() })
        .eq("id", row.id)
        .is("taken_at", null);
      if (updErr) throw new Error(updErr.message);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED ${row.id} (${row.storage_path}): ${msg}`);
    }
  }

  console.log(
    `\n${EXECUTE ? "Backfilled" : "Would backfill"} ${rows.length - failed}/${rows.length}: ` +
      `${counts.exif} from EXIF, ${counts["exif-backup"]} from -original backup, ` +
      `${counts.created_at} fell back to created_at.${failed ? ` ${failed} FAILED.` : ""}`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error("\ntaken_at backfill failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
