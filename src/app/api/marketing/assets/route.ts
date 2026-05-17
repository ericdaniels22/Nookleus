import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

// Logged-in only — matches the route's prior cookie-auth check. Reads and
// writes the marketing-asset library with the Service client, org-scoped
// to the Active Organization.
export const GET = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const supabase = ctx.serviceClient!;
    const tags = new URL(request.url).searchParams.get("tags");

    let query = supabase
      .from("marketing_assets")
      .select("*")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false });

    if (tags) {
      const tagArr = tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (tagArr.length > 0) {
        query = query.overlaps("tags", tagArr);
      }
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ assets: data || [] });
  },
);

export const POST = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const description = formData.get("description") as string | null;
    const tagsStr = formData.get("tags") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Use PNG, JPG, WebP, or GIF." },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum 10MB." },
        { status: 400 }
      );
    }

    const orgId = ctx.orgId;
    const supabase = ctx.serviceClient!;
    const ext = file.name.split(".").pop() || "png";
    const storagePath = `${orgId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from("marketing-assets")
      .upload(storagePath, buffer, { contentType: file.type });

    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const tags = tagsStr
      ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    const { data, error: insertError } = await supabase
      .from("marketing_assets")
      .insert({
        organization_id: orgId,
        file_name: file.name,
        storage_path: storagePath,
        description: description || null,
        tags,
        uploaded_by: ctx.userId,
      })
      .select()
      .single();

    if (insertError) {
      // Clean up uploaded file
      await supabase.storage.from("marketing-assets").remove([storagePath]);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ asset: data });
  },
);

export const DELETE = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const orgId = ctx.orgId;
    const supabase = ctx.serviceClient!;

    // Get the asset to find storage path (scoped to org)
    const { data: asset } = await supabase
      .from("marketing_assets")
      .select("storage_path")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    // Delete from storage
    await supabase.storage.from("marketing-assets").remove([asset.storage_path]);

    // Delete from DB
    const { error } = await supabase
      .from("marketing_assets")
      .delete()
      .eq("id", id)
      .eq("organization_id", orgId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  },
);
