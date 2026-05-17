import { NextResponse } from "next/server";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import type { Contract } from "@/lib/contracts/types";

// GET /api/contracts/[id]/pdf[?inline=1]
// Auth-gated access to the signed PDF. Default is attachment (download).
// Pass ?inline=1 to render in-browser — used by the View button so the
// user can scroll through the signed contract without saving it first.
//
// Logged-in only; the Service client downloads the signed PDF blob.
export const GET = withRequestContext(
  { serviceClient: true },
  async (req, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const inline = new URL(req.url).searchParams.get("inline") === "1";
    const { id } = await params;
    const supabase = ctx.serviceClient!;
    const { data: contract } = await supabase
      .from("contracts")
      .select("id, title, signed_pdf_path")
      .eq("id", id)
      .maybeSingle<Pick<Contract, "id" | "title" | "signed_pdf_path">>();
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    if (!contract.signed_pdf_path) {
      return NextResponse.json({ error: "Contract has not been signed yet" }, { status: 409 });
    }

    const { data, error } = await supabase.storage
      .from("contract-pdfs")
      .download(contract.signed_pdf_path);
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Failed to load PDF" },
        { status: 500 },
      );
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    // HTTP headers are ASCII only, so we need both an ASCII-safe fallback
    // filename and an RFC 5987 filename* for clients that support UTF-8.
    // Titles here often contain em-dashes / accented names which would
    // otherwise blow up with a ByteString conversion error.
    const safeTitle = contract.title.replace(/[\\/:*?"<>|]/g, "_");
    const asciiFilename = safeTitle
      .replace(/[\u2010-\u2015]/g, "-") // dashes
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x00-\x7F]/g, "_");
    const asciiPart = `filename="${asciiFilename}.pdf"`;
    const utf8Part = `filename*=UTF-8''${encodeURIComponent(`${safeTitle}.pdf`)}`;
    const disposition = inline ? "inline" : "attachment";
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; ${asciiPart}; ${utf8Part}`,
        "Content-Length": String(buffer.length),
      },
    });
  },
);
