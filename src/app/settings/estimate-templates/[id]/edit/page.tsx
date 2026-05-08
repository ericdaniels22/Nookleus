import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getTemplateWithContents } from "@/lib/estimate-templates";
import { EstimateBuilder } from "@/components/estimate-builder/estimate-builder";

export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const tmpl = await getTemplateWithContents(supabase, id);
  if (!tmpl) notFound();
  return <EstimateBuilder entity={{ kind: "template", data: tmpl }} />;
}
