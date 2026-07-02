import { describe, expect, it } from "vitest";

import { detectBotSender } from "./email-bot-detector";

describe("detectBotSender — no-reply addresses", () => {
  it("flags a no-reply address as a bot sender", () => {
    const verdict = detectBotSender({
      from_address: "no-reply@notifications.example.com",
      from_name: "Example Updates",
    });

    expect(verdict.isBot).toBe(true);
    expect(verdict.reason).toBe("no_reply_address");
  });
});

describe("detectBotSender — bot display names", () => {
  it("flags a '[bot]' display name as a bot sender", () => {
    const verdict = detectBotSender({
      from_address: "notifications@github.com",
      from_name: "vercel[bot]",
    });

    expect(verdict.isBot).toBe(true);
    expect(verdict.reason).toBe("bot_display_name");
  });
});

describe("detectBotSender — automated headers", () => {
  it("flags mail with Auto-Submitted set (not 'no') as a bot sender", () => {
    const verdict = detectBotSender({
      from_address: "helpdesk@vendor.example.com",
      from_name: "Vendor Support",
      headers: { "auto-submitted": "auto-generated" },
    });

    expect(verdict.isBot).toBe(true);
    expect(verdict.reason).toBe("automated_header");
  });

  it("does not flag mail whose Auto-Submitted header is explicitly 'no'", () => {
    const verdict = detectBotSender({
      from_address: "person@vendor.example.com",
      from_name: "A Person",
      headers: { "auto-submitted": "no" },
    });

    expect(verdict.isBot).toBe(false);
    expect(verdict.reason).toBe(null);
  });

  it("flags mail with a bulk Precedence header as a bot sender", () => {
    const verdict = detectBotSender({
      from_address: "list@vendor.example.com",
      from_name: "A Mailing List",
      headers: { precedence: "bulk" },
    });

    expect(verdict.isBot).toBe(true);
    expect(verdict.reason).toBe("automated_header");
  });
});

describe("detectBotSender — human mail", () => {
  it("does not flag ordinary personal mail as a bot sender", () => {
    const verdict = detectBotSender({
      from_address: "jane.smith@gmail.com",
      from_name: "Jane Smith",
      headers: { "list-unsubscribe": "<mailto:x@gmail.com>" },
    });

    expect(verdict.isBot).toBe(false);
    expect(verdict.reason).toBe(null);
  });

  it("does not treat a plain address like 'replies@' as no-reply", () => {
    const verdict = detectBotSender({
      from_address: "replies@vendor.example.com",
      from_name: "Vendor",
    });

    expect(verdict.isBot).toBe(false);
    expect(verdict.reason).toBe(null);
  });
});
