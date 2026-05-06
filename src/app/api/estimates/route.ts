import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { generateEstimateNumber } from "@/lib/estimates";
import { apiDbError } from "@/lib/api-errors";
import type { Estimate } from "@/lib/types";

interface CreatePayload {
  job_id: string;
  title?: string;
}

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "create_estimates");
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as CreatePayload;
  if (!body.job_id) return NextResponse.json({ error: "job_id required" }, { status: 400 });

  const orgId = await getActiveOrganizationId(supabase);

  // Default title from settings if not supplied
  let title = body.title?.trim();
  if (!title) {
    const { data: setting } = await supabase
      .from("company_settings")
      .select("value")
      .eq("organization_id", orgId)
      .eq("key", "default_estimate_title")
      .maybeSingle();
    title = setting?.value || "Estimate";
  }

  const numbered = await generateEstimateNumber(body.job_id, supabase);

  const { data: estimate, error } = await supabase
    .from("estimates")
    .insert({
      organization_id: orgId,
      job_id: body.job_id,
      estimate_number: numbered.estimate_number,
      sequence_number: numbered.sequence_number,
      title,
      status: "draft",
      created_by: auth.userId,
    })
    .select("*")
    .single<Estimate>();
  if (error) {
    return apiDbError(error.message, "POST /api/estimates insert");
  }

  return NextResponse.json({ estimate }, { status: 201 });
}

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const auth = await requirePermission(supabase, "view_estimates");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("job_id");
  if (!jobId) return NextResponse.json({ error: "job_id query param required" }, { status: 400 });

  const { data, error } = await supabase
    .from("estimates")
    .select("*")
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .order("sequence_number", { ascending: true })
    .returns<Estimate[]>();
  if (error) return apiDbError(error.message, "GET /api/estimates list");

  return NextResponse.json({ estimates: data ?? [] });
}
