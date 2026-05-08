import { NextResponse } from "next/server";

// Redacts a server-side error before sending it to the client. Postgres /
// Supabase error messages can leak schema details, constraint names, RLS
// policy text, etc. Log the full message server-side so we can debug, return
// a generic envelope to the caller.
//
// Use at every API-route catch site that maps an internal error to a 5xx:
//   try { ... } catch (e) { return apiError(e, "saving estimate"); }
export function apiError(
  err: unknown,
  context: string,
  status: 500 | 502 | 503 = 500,
): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[api] ${context}:`, message);
  return NextResponse.json(
    { error: "internal error" },
    { status },
  );
}

// Variant for direct error-string usage (e.g. supabase-js's PostgrestError
// returned through `{ error }`). Same redaction behaviour.
export function apiDbError(
  message: string,
  context: string,
  status: 500 | 502 | 503 = 500,
): NextResponse {
  console.error(`[api] ${context}:`, message);
  return NextResponse.json(
    { error: "internal error" },
    { status },
  );
}
