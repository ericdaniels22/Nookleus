import type { SupabaseClient } from "@supabase/supabase-js";
import { stampVoidWatermark } from "./pdf-void-watermark";

const BUCKET = "contracts";

export function computeVoidSidecarPath(canonicalPath: string): string {
  return `${canonicalPath}.voided.pdf`;
}

// Non-destructive replacement for the old "download → stamp → overwrite"
// flow in the void route. The canonical signed-PDF key is never touched;
// restoring a signed contract is therefore a pure status flip and the
// original file remains intact. Permanent delete is responsible for
// cleaning up both keys.
export async function writeVoidWatermarkSidecar(
  supabase: SupabaseClient,
  canonicalPath: string,
): Promise<{ sidecarPath: string }> {
  const sidecarPath = computeVoidSidecarPath(canonicalPath);

  const dl = await supabase.storage.from(BUCKET).download(canonicalPath);
  if (dl.error || !dl.data) {
    throw new Error(
      `writeVoidWatermarkSidecar: failed to load canonical PDF at ${canonicalPath}` +
        (dl.error ? `: ${dl.error.message}` : ""),
    );
  }
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  const stamped = await stampVoidWatermark(bytes);

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(sidecarPath, stamped, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) {
    throw new Error(
      `writeVoidWatermarkSidecar: upload failed at ${sidecarPath}: ${upErr.message}`,
    );
  }

  return { sidecarPath };
}
