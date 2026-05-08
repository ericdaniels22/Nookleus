// src/app/settings/pdf-presets/[id]/edit/page.tsx
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getPreset } from "@/lib/pdf-presets";
import { notFound, redirect } from "next/navigation";
import PresetEditClient from "./preset-edit-client";

export const dynamic = "force-dynamic";

export default async function PdfPresetEditPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const preset = await getPreset(supabase, id);
  if (!preset) notFound();
  return <PresetEditClient initial={preset} />;
}
