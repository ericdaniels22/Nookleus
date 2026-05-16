import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";

interface CreatePayload {
  job_id: string;
  vendor_id: string | null;
  vendor_name: string;
  category_id: string;
  amount: number;
  expense_date: string;
  payment_method: "business_card" | "business_ach" | "cash" | "personal_reimburse" | "other";
  description: string | null;
  receipt_path: string | null;
  thumbnail_path: string | null;
}

// Logging an expense needs the `log_expenses` permission (admins auto-pass)
// and the Service client to call the create RPC. The Request Context does
// not carry the user's `full_name` — no other endpoint needs it — so this
// route keeps its own small `user_profiles` lookup, preserving the
// "Profile not found" 403 the inline gate used to return.
export const POST = withRequestContext(
  { permission: "log_expenses", serviceClient: true },
  async (request, ctx) => {
    const { data: profile } = await ctx.supabase
      .from("user_profiles")
      .select("full_name")
      .eq("id", ctx.userId)
      .maybeSingle<{ full_name: string }>();
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 403 });
    }

    const body = (await request.json()) as CreatePayload;
    if (!body.job_id || !body.category_id || !body.vendor_name || typeof body.amount !== "number") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const ALLOWED_PAYMENT_METHODS = ["business_card", "business_ach", "cash", "personal_reimburse", "other"];
    if (!ALLOWED_PAYMENT_METHODS.includes(body.payment_method)) {
      return NextResponse.json({ error: "Invalid payment_method" }, { status: 400 });
    }
    if (typeof body.expense_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.expense_date) || Number.isNaN(new Date(body.expense_date).getTime())) {
      return NextResponse.json({ error: "Invalid expense_date (must be YYYY-MM-DD)" }, { status: 400 });
    }

    const { data, error } = await ctx.serviceClient!.rpc("create_expense_with_activity", {
      p_job_id: body.job_id,
      p_vendor_id: body.vendor_id,
      p_vendor_name: body.vendor_name,
      p_category_id: body.category_id,
      p_amount: body.amount,
      p_expense_date: body.expense_date,
      p_payment_method: body.payment_method,
      p_description: body.description,
      p_receipt_path: body.receipt_path,
      p_thumbnail_path: body.thumbnail_path,
      p_submitted_by: ctx.userId,
      p_submitter_name: profile.full_name,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ id: data }, { status: 201 });
  },
);
