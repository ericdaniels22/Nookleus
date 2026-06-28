// Auth-gate coverage for src/proxy.ts (Next 16's renamed middleware).
//
// The OAuth app-verification follow-up (#789) adds publicly reachable
// marketing and legal pages — /welcome, /privacy, /terms — so Google's
// verification reviewers can reach the home page and privacy policy WITHOUT a
// Nookleus session. This pins that those exact paths are allowed through the
// auth gate for an unauthenticated visitor, while a normal protected route is
// still bounced to /login.
//
// It also pins the load-bearing subtleties: the allowlist matches the new
// pages EXACTLY (a near-miss like /welcome-hack is still gated), a trailing
// slash and query string still resolve to the public page, the pre-existing
// public routes (/set-password, /sign/, /pay/) stay open, and the apex "/"
// dashboard stays gated.

import { describe, it, expect, vi } from "vitest";

// The proxy builds a Supabase server client and calls auth.getUser(). For
// these tests the visitor is signed out, so getUser() resolves a null user.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function requestFor(path: string) {
  return new NextRequest(new URL(`https://www.nookleus.app${path}`));
}

describe("proxy auth gate — public OAuth-verification routes (#789)", () => {
  it.each(["/welcome", "/privacy", "/terms"])(
    "lets an unauthenticated visitor reach %s without redirecting to /login",
    async (path) => {
      const res = await proxy(requestFor(path));
      // A genuine pass-through has no Location header at all.
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it.each(["/set-password", "/sign/abc123", "/pay/abc123"])(
    "keeps the pre-existing public route %s open without auth",
    async (path) => {
      const res = await proxy(requestFor(path));
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it.each(["/welcome?ref=google", "/welcome/"])(
    "resolves %s to the public /welcome page (query/trailing slash)",
    async (path) => {
      const res = await proxy(requestFor(path));
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it.each(["/welcome-hack", "/privacyz", "/termsx"])(
    "gates the near-miss %s — the allowlist matches exactly, not by prefix",
    async (path) => {
      const res = await proxy(requestFor(path));
      expect(res.headers.get("location")).toContain("/login");
    },
  );

  it.each(["/jobs", "/"])(
    "still bounces the unauthenticated protected route %s to /login",
    async (path) => {
      const res = await proxy(requestFor(path));
      expect(res.headers.get("location")).toContain("/login");
    },
  );
});
