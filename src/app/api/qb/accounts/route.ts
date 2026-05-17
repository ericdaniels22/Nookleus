import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { getValidAccessToken } from "@/lib/qb/tokens";
import { listAccountsByType, listDepositAccounts } from "@/lib/qb/client";

// GET /api/qb/accounts
// Default (no ?types=) — Bank + Other Current Asset (payment-method mapping).
// With ?types=Income,Expense — returns the specified account types instead.
async function getAccounts(request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  const token = await getValidAccessToken(service);
  if (!token) {
    return NextResponse.json(
      { error: "no active connection" },
      { status: 400 },
    );
  }
  try {
    const typesParam = new URL(request.url).searchParams.get("types");
    const accounts = typesParam
      ? await listAccountsByType(
          token,
          typesParam.split(",").map((t) => t.trim()).filter(Boolean),
        )
      : await listDepositAccounts(token);
    return NextResponse.json({ accounts });
  } catch (err) {
    const anyErr = err as { message?: string; status?: number; code?: string; detail?: string; raw?: unknown };
    console.error("[qb/accounts]", { message: anyErr?.message, status: anyErr?.status, code: anyErr?.code, detail: anyErr?.detail, raw: anyErr?.raw });
    return NextResponse.json(
      {
        error: anyErr?.message ?? "QB API error",
        status: anyErr?.status,
        code: anyErr?.code,
        detail: anyErr?.detail,
      },
      { status: 502 },
    );
  }
}

export const GET = withRequestContext(
  { adminOnly: true, serviceClient: true },
  getAccounts,
);
