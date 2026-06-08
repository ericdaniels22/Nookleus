import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import {
  signedUrlForPhoneRecording,
  type PhoneRecordingStorageClient,
} from "@/lib/phone/recordings-storage";

// PRD #304 — Nookleus Phone. Slice 9 (#313) — voicemail-recording signed URL.
//
// Thread render needs a short-lived public URL for a stored voicemail MP3 so
// the <audio> element can play it. Mirrors GET /api/phone/attachments: it is
// view_phone gated and signs through the Service client, but cross-org reads
// are refused at the path level — every recording lives under `{org}/...` in
// the phone-recordings bucket, so a path outside the caller's Organization
// prefix is a 404 (we never even ask Storage to sign it).

const SIGNED_URL_TTL_SECONDS = 600; // 10 minutes

export const GET = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (request, ctx) => {
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }
    const path = new URL(request.url).searchParams.get("path");
    if (!path) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (!path.startsWith(`${ctx.orgId}/`)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
      const url = await signedUrlForPhoneRecording(
        ctx.serviceClient as unknown as PhoneRecordingStorageClient,
        path,
        SIGNED_URL_TTL_SECONDS,
      );
      return NextResponse.json({ url });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Not found";
      return NextResponse.json({ error: message }, { status: 404 });
    }
  },
);
