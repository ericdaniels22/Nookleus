// Next 16 renamed `middleware` → `proxy`. This file replaces the old
// middleware.ts (which was silently ignored on Next 16, leaving the app
// completely unauthenticated). The exported function MUST be named `proxy`
// (or be the default export); `middleware` is no longer recognised.
//
// Caught by: scratch rehearsal smoke test (2026-04-22). /settings/users
//   showed Eric as signed in but /api/settings/users returned [] because
//   no Supabase session cookies were ever set. Tracing back: the file
//   middleware.ts at the repo root never ran, so no session refresh ever
//   happened and no auth gate redirected unauthenticated users to /login.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session
  const { data: { user } } = await supabase.auth.getUser();

  // Allow login page, API routes, and customer-facing public pages
  // (contract signing and payment) without auth. /set-password is also
  // public: crew members land there from an emailed recovery link before
  // they have any session, and the recovery tokens arrive in the URL hash
  // (client-only), so the page must load without an auth redirect.
  //
  // The marketing landing (/welcome) and legal pages (/privacy, /terms) are
  // public too: Google's OAuth app verification (#789) requires reviewers to
  // reach the home page and privacy policy without a Nookleus session.
  //
  // Normalise a single trailing slash before the allowlist checks below. Next
  // 16 only 308-normalises /welcome/ → /welcome at the filesystem-route step,
  // which runs AFTER this proxy — so without stripping it here, an unauth
  // visitor who appends a slash (or follows a trailing-slash link) would fail
  // the exact `===` match and get bounced to /login, defeating verification.
  const rawPathname = request.nextUrl.pathname;
  const pathname =
    rawPathname.length > 1 && rawPathname.endsWith("/")
      ? rawPathname.slice(0, -1)
      : rawPathname;
  const isLoginPage = pathname === "/login";
  const isPublicApi = pathname.startsWith("/api/");
  const isPublicPage =
    pathname.startsWith("/sign/") ||
    pathname.startsWith("/pay/") ||
    pathname === "/set-password" ||
    pathname === "/welcome" ||
    pathname === "/privacy" ||
    pathname === "/terms";

  if (!user && !isLoginPage && !isPublicApi && !isPublicPage) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect logged-in users away from login page
  if (user && isLoginPage) {
    const homeUrl = new URL("/", request.url);
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Excludes Next-internals, common image extensions, the pdf.js worker
    // file at /pdf.worker.min.mjs (served from /public so the public
    // /sign/[token] page can render contract PDFs without an auth-redirect
    // dance), and the PWA manifest.webmanifest.
    "/((?!_next/static|_next/image|favicon.ico|logo.png|manifest\\.webmanifest|pdf\\.worker\\.min\\.mjs|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
