// src/app/settings/pdf-presets/page.tsx
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { listPresets } from "@/lib/pdf-presets";
import { redirect } from "next/navigation";
import PresetListClient from "./preset-list-client";

export const dynamic = "force-dynamic";

export default async function PdfPresetsSettingsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const presets = await listPresets(supabase);
  return <PresetListClient initialPresets={presets} />;
}
