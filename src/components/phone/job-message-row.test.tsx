// PRD #304 — Nookleus Phone. Slice 7 (#311) — Job-page message row.
//
// One text/MMS in the Job-page Messages section. Keeps the Phone-tab
// bubble treatment (inbound left/muted, outbound right/primary) and adds a
// per-message context header (counterparty + timestamp) — the Job section
// shows messages across many conversations, so each needs to say who it
// was with and when.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobMessageRow } from "./job-message-row";
import type { PhoneAttachmentRef } from "./message-attachment";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Row = {
  id: string;
  direction: "in" | "out";
  from_e164: string;
  to_e164: string;
  body: string | null;
  media_urls: PhoneAttachmentRef[];
  sent_at: string;
  counterpartyLabel: string;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "m1",
    direction: "in",
    from_e164: "+15125550001",
    to_e164: "+15125559999",
    body: "Roof leaking",
    media_urls: [],
    sent_at: "2026-06-01T10:00:00Z",
    counterpartyLabel: "Homer Owner",
    ...overrides,
  };
}

describe("JobMessageRow — bubble treatment", () => {
  it("renders an inbound message left-aligned in the muted bubble", () => {
    render(
      <JobMessageRow message={row({ direction: "in", body: "Roof leaking" })} />,
    );
    const bubble = screen.getByText("Roof leaking");
    expect(bubble.className).toContain("bg-muted");
    expect(bubble.parentElement!.className).toMatch(/items-start|self-start/);
  });

  it("renders an outbound message right-aligned in the primary bubble", () => {
    render(
      <JobMessageRow message={row({ direction: "out", body: "On our way" })} />,
    );
    const bubble = screen.getByText("On our way");
    // design-v2 (#921): the outbound bubble is the primary fill, not the
    // legacy --brand-primary hex.
    expect(bubble.className).toContain("bg-primary");
    expect(bubble.className).toContain("text-primary-foreground");
    expect(bubble.parentElement!.className).toMatch(/items-end|self-end/);
  });
});

describe("JobMessageRow — context header", () => {
  it("shows the counterparty label and a formatted timestamp", () => {
    render(
      <JobMessageRow
        message={row({
          counterpartyLabel: "Homer Owner",
          sent_at: "2026-06-01T15:30:00Z",
        })}
      />,
    );
    expect(screen.getByText("Homer Owner")).toBeDefined();
    // Clock time in `h:mm a` form — assert the shape, not the exact value
    // (jsdom's timezone is environment-dependent).
    expect(screen.getByText(/\d{1,2}:\d{2}\s*(AM|PM)/i)).toBeDefined();
  });
});

describe("JobMessageRow — MMS attachments", () => {
  it("renders an image attachment as a thumbnail button and a non-image as a download link", async () => {
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ url: "https://signed.example/x" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", spy);

    render(
      <JobMessageRow
        message={row({
          body: "see photos",
          media_urls: [
            {
              storage_path: "org/img.jpg",
              media_type: "image/jpeg",
              filename: "img.jpg",
            },
            {
              storage_path: "org/doc.pdf",
              media_type: "application/pdf",
              filename: "doc.pdf",
            },
          ],
        })}
      />,
    );

    expect(
      await screen.findByRole("button", { name: /open attachment img\.jpg/i }),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: /doc\.pdf/i })).toBeDefined();
  });
});
