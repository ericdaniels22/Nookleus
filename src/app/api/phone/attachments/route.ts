import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { validateMmsAttachment } from "@/lib/phone/mms-attachments";
import {
  uploadPhoneAttachment,
  signedUrlForPhoneAttachment,
  type PhoneStorageClient,
} from "@/lib/phone/attachments-storage";

// PRD #304 — Nookleus Phone. Slice 6 (#310) — MMS attachment upload + signed URL.
//
// POST: a Crew Lead drags an image (or PDF / short video) into the compose
// box. The browser uploads it here BEFORE the outbound /api/phone/messages
// call — that way the message route can mint a signed URL and hand it to
// Twilio as `mediaUrl[]`, and the persisted `phone_messages.media_urls`
// entry already points at a Nookleus-owned object that survives Twilio's
// media retention.
//
// GET: thread render needs a short-lived public URL for the stored object —
// images render inline, non-images surface a download link. Cross-org
// reads are refused at the path level (the object path is `{org}/...`).

const SIGNED_URL_TTL_SECONDS = 600; // 10 minutes

export const POST = withRequestContext(
  { permission: "view_phone", serviceClient: true },
  async (request, ctx) => {
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const validation = validateMmsAttachment({
      type: file.type,
      size: file.size,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    let stored: { storagePath: string };
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      stored = await uploadPhoneAttachment(
        ctx.serviceClient as unknown as PhoneStorageClient,
        {
          orgId: ctx.orgId,
          mediaType: validation.mediaType,
          bytes,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "upload failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return NextResponse.json({
      attachment: {
        kind: validation.kind,
        media_type: validation.mediaType,
        storage_path: stored.storagePath,
        filename: file.name || undefined,
      },
    });
  },
);

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
    // Org scoping — the object path begins with the org id. Refuse to mint
    // a URL for anything outside the caller's Organization prefix.
    if (!path.startsWith(`${ctx.orgId}/`)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
      const url = await signedUrlForPhoneAttachment(
        ctx.serviceClient as unknown as PhoneStorageClient,
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
