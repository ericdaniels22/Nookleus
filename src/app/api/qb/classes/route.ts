import { NextResponse } from "next/server";
import {
  withRequestContext,
  type RequestContext,
} from "@/lib/request-context/with-request-context";
import { getValidAccessToken } from "@/lib/qb/tokens";
import { listClasses } from "@/lib/qb/client";

// GET /api/qb/classes — returns active QB Classes for the damage-type
// mapping dropdown. If the user hasn't enabled Classes in QBO, the
// returned list is empty and the wizard UI explains what to do.
async function getClasses(_request: Request, ctx: RequestContext) {
  const service = ctx.serviceClient!;
  const token = await getValidAccessToken(service);
  if (!token) {
    return NextResponse.json(
      { error: "no active connection" },
      { status: 400 },
    );
  }
  try {
    const classes = await listClasses(token);
    return NextResponse.json({ classes });
  } catch (err) {
    const anyErr = err as { message?: string; status?: number; code?: string; detail?: string; raw?: unknown };
    console.error("[qb/classes]", { message: anyErr?.message, status: anyErr?.status, code: anyErr?.code, detail: anyErr?.detail, raw: anyErr?.raw });
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
  getClasses,
);
