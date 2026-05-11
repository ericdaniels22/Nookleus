import { NextResponse } from "next/server";

export async function POST() {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(
    { error: "synthetic_test_failure" },
    { status: 500 },
  );
}
