import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import {
  validateAttachment,
  resizeImage,
} from "@/lib/jarvis/attachments/normalize";
import {
  uploadAttachment,
  JARVIS_ATTACHMENTS_BUCKET,
  type StorageClient,
} from "@/lib/jarvis/attachments/storage";
import { uploadPdfToAnthropic } from "@/lib/jarvis/attachments/anthropic-files";
import type { JarvisAttachment } from "@/lib/types";

// Issue #198, #199 — Jarvis Chat attachments.
//
// POST: accepts a single image or PDF, validates type/size, resizes large
// images, stores the bytes in the private `jarvis-attachments` bucket, and
// returns an attachment reference for the client to attach to its message.
// A PDF is additionally uploaded to the Anthropic Files API so it can be
// referenced by file_id on every replay (#199).
//
// GET: returns a short-lived signed URL for rendering a stored attachment.
//
// Logged-in only — matches the Jarvis chat route. The Service client owns
// all bucket I/O (RLS bypassed); the object path is always built from the
// trusted Request-Context org id, so an attachment can never land outside
// the caller's Organization prefix.

const SIGNED_URL_TTL_SECONDS = 600;

export const POST = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const conversationId = formData.get("conversation_id");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 },
      );
    }
    if (typeof conversationId !== "string" || !conversationId) {
      return NextResponse.json(
        { error: "conversation_id is required" },
        { status: 400 },
      );
    }

    const validation = validateAttachment({
      type: file.type,
      size: file.size,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    let attachment: JarvisAttachment;
    try {
      const original = Buffer.from(await file.arrayBuffer());

      if (validation.kind === "pdf") {
        // PDFs are not resized. Store the bytes, then upload to the
        // Anthropic Files API — a failed Files upload throws, so the catch
        // below rejects the whole attachment (a PDF with no file_id can
        // never reach Claude).
        const stored = await uploadAttachment(
          ctx.serviceClient as StorageClient,
          {
            orgId: ctx.orgId,
            conversationId,
            mediaType: validation.mediaType,
            bytes: original,
          },
        );
        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });
        const fileId = await uploadPdfToAnthropic(anthropic, {
          bytes: original,
          filename: file.name || "document.pdf",
        });
        attachment = {
          kind: "pdf",
          storage_path: stored.storagePath,
          media_type: validation.mediaType,
          filename: file.name || undefined,
          file_id: fileId,
        };
      } else {
        const resized = await resizeImage(original, validation.mediaType);
        const stored = await uploadAttachment(
          ctx.serviceClient as StorageClient,
          {
            orgId: ctx.orgId,
            conversationId,
            mediaType: resized.mediaType,
            bytes: resized.bytes,
          },
        );
        attachment = {
          kind: "image",
          storage_path: stored.storagePath,
          media_type: resized.mediaType,
          filename: file.name || undefined,
        };
      }
    } catch (err) {
      console.error("Jarvis attachment upload failed:", err);
      return NextResponse.json(
        {
          error:
            "Couldn't process that file — try again, or pick a different one.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ attachment });
  },
);

export const GET = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
    if (!ctx.orgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 403 },
      );
    }

    const path = new URL(request.url).searchParams.get("path");
    if (!path) {
      return NextResponse.json(
        { error: "path is required" },
        { status: 400 },
      );
    }
    // Org scoping: the object path starts with the org id. Refuse to mint a
    // URL for anything outside the caller's Organization prefix.
    if (!path.startsWith(`${ctx.orgId}/`)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data, error } = await ctx
      .serviceClient!.storage.from(JARVIS_ATTACHMENTS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Attachment not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ url: data.signedUrl });
  },
);
