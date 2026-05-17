import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

// POST /api/settings/company/logo — upload company logo (org-prefixed path).
// Logged-in only — previously ungated (recorded for the #78 ungated list).
export const POST = withRequestContext({}, async (request, ctx) => {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Invalid file type. Use PNG, JPG, SVG, or WebP." },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "File too large. Maximum 2MB." },
      { status: 400 }
    );
  }

  const orgId = ctx.orgId;

  // Delete old logo if exists (scoped to org)
  const { data: existing } = await ctx.supabase
    .from("company_settings")
    .select("value")
    .eq("organization_id", orgId)
    .eq("key", "logo_path")
    .maybeSingle();

  if (existing?.value) {
    await ctx.supabase.storage.from("company-assets").remove([existing.value]);
  }

  // Upload new logo at {org_id}/logo/{timestamp}-rand.ext
  const ext = file.name.split(".").pop() || "png";
  const fileName = `${orgId}/logo/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await ctx.supabase.storage
    .from("company-assets")
    .upload(fileName, buffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadError.message}` },
      { status: 500 }
    );
  }

  // Save path to company_settings
  await ctx.supabase
    .from("company_settings")
    .upsert(
      { organization_id: orgId, key: "logo_path", value: fileName, updated_at: new Date().toISOString() },
      { onConflict: "organization_id,key" }
    );

  // Return public URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/company-assets/${fileName}`;

  return NextResponse.json({ path: fileName, url: publicUrl });
});
