import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// The rich-text editor is replaced with a plain textarea so the modal renders
// in jsdom without the Tiptap/ProseMirror runtime.
vi.mock("@/components/tiptap-editor", () => ({
  default: ({
    content,
    onChange,
    placeholder,
  }: {
    content: string;
    onChange: (html: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="email-body"
      placeholder={placeholder}
      defaultValue={content}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
// PreviewContractModal runs its own fetches when mounted; stub it out.
vi.mock("./preview-contract-modal", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SendContractModal from "./send-contract-modal";

// A settings payload whose body is MESSAGE-ONLY — it carries no
// {{signing_link}} token. Pre-#691 this tripped the client guard; post-#691
// the link lives on the card's action button, so a tokenless body is valid.
const MESSAGE_ONLY_SETTINGS = {
  organization_id: "org-1",
  provider: "resend",
  send_from_email: "contracts@aaa.test",
  send_from_name: "AAA Contracts",
  default_link_expiry_days: 7,
  reminder_day_offsets: [],
  signing_request_subject_template: "Please sign your agreement",
  signing_request_body_template:
    "<p>Hi there, please review and sign at your convenience.</p>",
  button_label: "Review & sign",
  button_color: "#1f2937",
  logo_visible: true,
};

const ACTIVE_TEMPLATE = {
  id: "tpl-1",
  name: "Roof Replacement Agreement",
  description: null,
  pdf_page_count: 1,
  signer_count: 1,
  is_active: true,
  updated_at: "2026-06-23T00:00:00Z",
};

function stubFetch() {
  const fetchSpy = vi.fn(async (url: string) => {
    if (url.includes("/api/settings/contract-templates")) {
      return new Response(JSON.stringify([ACTIVE_TEMPLATE]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/settings/contract-email")) {
      return new Response(JSON.stringify(MESSAGE_ONLY_SETTINGS), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/contracts/preflight")) {
      return new Response(JSON.stringify({ unresolvedAutoCheckboxes: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SendContractModal — branded card (#691)", () => {
  it("accepts a message-only body: Send stays enabled and no {{signing_link}} warning shows", async () => {
    render(
      <SendContractModal
        open
        onOpenChange={() => {}}
        jobId="job-1"
        defaultSignerName="Pat Owner"
        defaultSignerEmail="pat@owner.test"
        onSent={() => {}}
      />,
    );

    // Settings have loaded once the subject input shows the loaded template.
    await screen.findByDisplayValue("Please sign your agreement");

    // The body has no {{signing_link}} — yet the guard is gone, so neither the
    // inline warning nor the disabled Send button should appear.
    await waitFor(() => {
      const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
      expect(send.disabled).toBe(false);
    });
    expect(screen.queryByText(/Body is missing/i)).toBeNull();
  });
});
