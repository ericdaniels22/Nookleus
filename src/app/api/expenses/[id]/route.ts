import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";

// Editing or deleting an expense needs the `log_expenses` permission
// (admins auto-pass) — enforced by the wrapper. Beyond that, a non-admin
// may only touch their *own* expense; that ownership rule is route-specific
// business logic and stays here. The expense row is loaded with the Service
// client and scoped to the Active Organization.
async function loadExpenseForCaller(ctx: RequestContext, id: string) {
  const service = ctx.serviceClient!;
  const { data: expense } = await service
    .from("expenses")
    .select("id, submitted_by, receipt_path, thumbnail_path, activity_id")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle<{
      id: string;
      submitted_by: string;
      receipt_path: string | null;
      thumbnail_path: string | null;
      activity_id: string | null;
    }>();
  if (!expense) {
    return { ok: false as const, status: 404, error: "Expense not found" };
  }

  const isAdmin = ctx.role === "admin";
  const isSubmitter = expense.submitted_by === ctx.userId;
  if (!isAdmin && !isSubmitter) {
    return { ok: false as const, status: 403, error: "Permission denied" };
  }

  return { ok: true as const, expense, service };
}

export const PATCH = withRequestContext(
  { permission: "log_expenses", serviceClient: true },
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const caller = await loadExpenseForCaller(ctx, id);
    if (!caller.ok) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    const body = await request.json();
    const { error } = await caller.service.rpc("update_expense", {
      p_expense_id: id,
      p_vendor_id: body.vendor_id,
      p_vendor_name: body.vendor_name,
      p_category_id: body.category_id,
      p_amount: body.amount,
      p_expense_date: body.expense_date,
      p_payment_method: body.payment_method,
      p_description: body.description,
      p_receipt_path: body.receipt_path,
      p_thumbnail_path: body.thumbnail_path,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // If the photo was replaced, delete the old objects (caller provides the previous paths as query params).
    const { searchParams } = new URL(request.url);
    const oldReceipt = searchParams.get("old_receipt");
    const oldThumb = searchParams.get("old_thumb");
    const toRemove = [oldReceipt, oldThumb].filter((p): p is string => Boolean(p)
      && p !== body.receipt_path && p !== body.thumbnail_path);
    if (toRemove.length) await caller.service.storage.from("receipts").remove(toRemove);

    return NextResponse.json({ success: true });
  },
);

export const DELETE = withRequestContext(
  { permission: "log_expenses", serviceClient: true },
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const caller = await loadExpenseForCaller(ctx, id);
    if (!caller.ok) {
      return NextResponse.json({ error: caller.error }, { status: caller.status });
    }

    const { data, error } = await caller.service.rpc("delete_expense_cascade", { p_expense_id: id });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Storage cleanup — best effort; orphans are acceptable per spec.
    const row = Array.isArray(data) ? data[0] : data;
    const paths = [row?.receipt_path, row?.thumbnail_path].filter((p): p is string => Boolean(p));
    if (paths.length) {
      const { error: rmErr } = await caller.service.storage.from("receipts").remove(paths);
      if (rmErr) console.warn("receipts cleanup failed after expense delete", { id, paths, rmErr });
    }

    return NextResponse.json({ success: true });
  },
);
