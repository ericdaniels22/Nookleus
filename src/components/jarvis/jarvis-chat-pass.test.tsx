// Issue #922 — design system v2 step 14: the Jarvis chat pass. The §5 chat
// patterns are finalized here (presentation only — chat state, streaming,
// and tool execution are untouched). The binding rules from
// docs/design-system.md §5 exercised here:
//   - user messages on --muted (raised) bubbles aligned right
//   - Jarvis messages on --card with a --border hairline aligned left
//   - streaming shown as a single pulsing --accent-text dot (no skeletons)
//   - composer follows input conventions: 16px textarea so iOS doesn't zoom
//   - tokens only — no hardcoded colors in the message chrome
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { JarvisMessage as JarvisMessageType } from "@/lib/types";
import JarvisMessage from "./JarvisMessage";
import JarvisTypingIndicator from "./JarvisTypingIndicator";
import JarvisInput from "./JarvisInput";

const TS = "2026-07-01T12:00:00.000Z";

function userMessage(content = "how's the Smith job?"): JarvisMessageType {
  return { role: "user", content, timestamp: TS };
}

function jarvisMessage(content = "The Smith job is in progress."): JarvisMessageType {
  return { role: "assistant", content, timestamp: TS };
}

describe("JarvisMessage — §5 bubble surfaces", () => {
  it("puts a user message on a --muted (raised) bubble aligned right", () => {
    render(<JarvisMessage message={userMessage()} />);
    const bubble = document.querySelector('[data-slot="jarvis-bubble"]')!;
    expect(bubble).not.toBeNull();
    expect(bubble.className).toMatch(/\bbg-muted\b/);
    // §2.4 audit: accent tint is for the avatar, not the whole bubble.
    expect(bubble.className).not.toContain("bg-accent-tint");

    const row = document.querySelector('[data-slot="jarvis-message"]')!;
    expect(row.className).toContain("flex-row-reverse");
  });

  it("puts a Jarvis message on a --card bubble with a hairline border aligned left", () => {
    render(<JarvisMessage message={jarvisMessage()} />);
    const bubble = document.querySelector('[data-slot="jarvis-bubble"]')!;
    expect(bubble).not.toBeNull();
    expect(bubble.className).toMatch(/\bbg-card\b/);
    expect(bubble.className).toMatch(/\bborder\b/);
    expect(bubble.className).not.toMatch(/\bbg-muted\b/);

    const row = document.querySelector('[data-slot="jarvis-message"]')!;
    expect(row.className).not.toContain("flex-row-reverse");
  });
});

describe("JarvisMessage — §8 tokens only (no hardcoded colors)", () => {
  beforeEach(() => {
    // The attachment renderers fetch a signed URL on mount; keep it
    // deterministic so the chip renders in its unlinked state.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network")));
  });

  it("renders an attachment chip with tokens, never a hardcoded white", () => {
    render(
      <JarvisMessage
        message={{
          role: "user",
          content: "",
          timestamp: TS,
          attachments: [
            {
              kind: "pdf",
              storage_path: "org/conv/contract.pdf",
              media_type: "application/pdf",
              filename: "contract.pdf",
            },
          ],
        }}
      />,
    );
    const bubble = document.querySelector('[data-slot="jarvis-bubble"]')!;
    const offenders = Array.from(bubble.querySelectorAll("*"))
      .map((el) => el.getAttribute("class") || "")
      .filter((cls) => /white/.test(cls));
    expect(offenders).toEqual([]);
  });
});

describe("JarvisTypingIndicator — §5 streaming is one pulsing accent dot", () => {
  it("renders a single pulsing --accent-text dot, not three primary dots", () => {
    render(<JarvisTypingIndicator />);
    const dots = document.querySelectorAll('[data-slot="jarvis-streaming-dot"]');
    expect(dots).toHaveLength(1);

    const dot = dots[0];
    expect(dot.className).toMatch(/\bbg-accent-text\b/);
    expect(dot.className).toContain("animate-[jarvis-pulse");
    // The old three-dot bounce used the solid primary — gone now.
    expect(dot.className).not.toMatch(/\bbg-primary\b/);
  });
});

describe("JarvisInput — §5/§7.4 composer follows input conventions", () => {
  it("keeps the textarea at 16px so iOS doesn't zoom on focus", () => {
    const { container } = render(<JarvisInput onSend={vi.fn()} />);
    const textarea = container.querySelector("textarea")!;
    expect(textarea).not.toBeNull();
    expect(textarea.className).toMatch(/\btext-base\b/);
    // A sub-16px font (text-sm, or a md: downgrade) triggers iOS auto-zoom.
    expect(textarea.className).not.toMatch(/\btext-sm\b/);
    expect(textarea.className).not.toContain("md:text-sm");
  });
});
