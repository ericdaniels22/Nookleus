# Build 15h follow-up — iPad PWA signed-PDF access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close 15h findings #2 and #3 by giving staff an in-app signed-PDF viewer route + a download anchor that lands files directly in iPad Files (no Safari trip).

**Architecture:** New auth-gated route `/contracts/[id]/view` renders the signed PDF inline using a new flat `<SignedPdfViewer>` client component (react-pdf, dynamic-imported). Two existing call sites (post-sign in-person complete page; org-side contracts list per-row buttons) swap their `target="_blank"` View link for in-app navigation, and add a `download` attribute to their Download anchors. The existing `/api/contracts/[id]/pdf` route is unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, react-pdf 10 (dynamic-imported `ssr:false`), Supabase Storage, TypeScript.

**Spec:** `docs/superpowers/specs/2026-05-08-build-15h-followup-ipad-pdf-access-design.md`

---

## Pre-flight

This repo has no automated test runner. Verification is `npx tsc --noEmit` + `npm run build` after each task that ships code, and a final live AAA-prod smoke from Eric's iPad in PWA mode. Frequent commits between tasks; push only at the end of Task 7 after Eric's go-ahead.

The pdfjs worker is bundler-resolved via `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` in `src/lib/pdf/configure-pdfjs.ts` (15e fix). The new viewer reuses this — do not introduce a separate worker config.

react-pdf module-eval crashes under Next 16 SSR (15e debugged this for 4 commits). The new viewer **must** be loaded via `next/dynamic({ ssr: false })` from any server-component caller.

---

### Task 1: Shared filename sanitizer helper

**Files:**
- Create: `src/lib/contracts/pdf-filename.ts`

The `download` attribute and the route's `Content-Disposition` header should produce the same filename. Extracting the sanitizer keeps both honest.

- [ ] **Step 1: Create `src/lib/contracts/pdf-filename.ts`**

```ts
// Sanitize a contract title for use as a PDF filename. Same logic the
// /api/contracts/[id]/pdf route uses for its Content-Disposition header,
// extracted so the client-side <a download="..."> attribute on the
// post-sign and contracts-list pages produces an identical filename.
export function sanitizePdfFilename(title: string): string {
  const stripped = title.replace(/[\\/:*?"<>|]/g, "_");
  // Fold unicode dashes / smart quotes to ASCII so the filename matches
  // the route's ASCII-safe Content-Disposition fallback. Browsers writing
  // the file from the `download` attribute will use this name verbatim.
  return stripped
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/contracts/pdf-filename.ts
git commit -m "$(cat <<'EOF'
feat(15h-followup): shared PDF filename sanitizer

Extracts the title-to-filename logic from /api/contracts/[id]/pdf so the
client-side <a download="..."> attribute on the post-sign and contracts
-list pages produces an identical filename to the route's
Content-Disposition fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: SignedPdfViewer client component

**Files:**
- Create: `src/components/contracts/signed-pdf-viewer.tsx`

A flat read-only viewer. Sized via `ResizeObserver` on the container (matches `PdfCanvas` pattern). `configurePdfjs()` call inside `useEffect` so the worker registers before `<Document>` mounts.

- [ ] **Step 1: Create `src/components/contracts/signed-pdf-viewer.tsx`**

```tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { configurePdfjs } from "@/lib/pdf/configure-pdfjs";

interface Props {
  pdfUrl: string;
}

const HORIZONTAL_GUTTER_PX = 16;

export default function SignedPdfViewer({ pdfUrl }: Props) {
  const [numPages, setNumPages] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    configurePdfjs();
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = Math.max(1, containerWidth - HORIZONTAL_GUTTER_PX);

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-6 py-6">
      {containerWidth > 0 ? (
        <Document
          file={pdfUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={(error) =>
            console.error("[signed-pdf-viewer] Document onLoadError:", error)
          }
          loading={<div className="text-muted-foreground">Loading PDF…</div>}
          error={<div className="text-red-500">Failed to load PDF</div>}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div key={i + 1} className="shadow-lg">
              <Page
                pageNumber={i + 1}
                width={pageWidth}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              />
            </div>
          ))}
        </Document>
      ) : (
        <div className="text-muted-foreground py-12">Loading PDF…</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add src/components/contracts/signed-pdf-viewer.tsx
git commit -m "$(cat <<'EOF'
feat(15h-followup): SignedPdfViewer client component

Flat read-only react-pdf viewer for the new in-app PDF view route. Reuses
configurePdfjs() bundler-resolved worker (15e). Container-width fit via
ResizeObserver mirrors PdfCanvas. Distinct from PdfCanvas because the
viewer doesn't need overlay-field props.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: In-app viewer page

**Files:**
- Create: `src/app/contracts/[id]/view/page.tsx`

Server component. Auth-gated. Loads the contract row via service client. Branches on missing/unsigned/voided. Embeds `<SignedPdfViewer>` via `next/dynamic({ ssr: false })`.

- [ ] **Step 1: Create `src/app/contracts/[id]/view/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeft, Download } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { sanitizePdfFilename } from "@/lib/contracts/pdf-filename";
import type { Contract } from "@/lib/contracts/types";

const SignedPdfViewer = dynamic(
  () => import("@/components/contracts/signed-pdf-viewer"),
  { ssr: false },
);

export default async function ContractViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const authClient = await createServerSupabaseClient();
  const { data: { user }, error: authErr } = await authClient.auth.getUser();
  if (authErr || !user) {
    redirect(`/login?next=/contracts/${id}/view`);
  }

  const supabase = createServiceClient();
  const { data: contract } = await supabase
    .from("contracts")
    .select("id, job_id, title, status, signed_pdf_path, signed_at, void_reason")
    .eq("id", id)
    .maybeSingle<
      Pick<
        Contract,
        | "id"
        | "job_id"
        | "title"
        | "status"
        | "signed_pdf_path"
        | "signed_at"
        | "void_reason"
      >
    >();

  if (!contract) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold mb-2 text-foreground">
            Contract not found
          </h1>
          <Link
            href="/contracts"
            className="text-sm text-[var(--brand-primary)] hover:underline"
          >
            Back to contracts
          </Link>
        </div>
      </div>
    );
  }

  if (!contract.signed_pdf_path) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full text-center">
          <h1 className="text-lg font-semibold mb-2 text-foreground">
            Contract has not been signed yet
          </h1>
          <Link
            href={contract.job_id ? `/jobs/${contract.job_id}` : "/contracts"}
            className="text-sm text-[var(--brand-primary)] hover:underline"
          >
            {contract.job_id ? "Back to job" : "Back to contracts"}
          </Link>
        </div>
      </div>
    );
  }

  const signedLabel = contract.signed_at
    ? new Date(contract.signed_at).toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

  const filename = `${sanitizePdfFilename(contract.title)}.pdf`;
  const backHref = contract.job_id ? `/jobs/${contract.job_id}` : "/contracts";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ArrowLeft size={16} /> Back
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{contract.title}</h1>
            <p className="text-xs text-muted-foreground">
              {contract.status === "voided"
                ? `Voided${contract.void_reason ? ` · ${contract.void_reason}` : ""}`
                : `Signed ${signedLabel}`}
            </p>
          </div>
          <a
            href={`/api/contracts/${contract.id}/pdf`}
            download={filename}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all"
          >
            <Download size={14} /> Download
          </a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4">
        <SignedPdfViewer pdfUrl={`/api/contracts/${contract.id}/pdf?inline=1`} />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 3: Build verify**

Run: `npm run build`
Expected: ✓ Compiled successfully. The new route appears in the build output as `/contracts/[id]/view`.

- [ ] **Step 4: Commit**

```bash
git add src/app/contracts/[id]/view/page.tsx
git commit -m "$(cat <<'EOF'
feat(15h-followup): in-app /contracts/[id]/view PDF viewer page

Auth-gated server component. Renders the signed PDF inline via the new
SignedPdfViewer (dynamic-imported, ssr:false). Header has Back link to
the job (or /contracts), title + signed-at, and a Download anchor with
the sanitized filename. Voided contracts render normally with a Voided
pill in the header. Missing or unsigned contracts render dedicated
error cards. No call sites yet — wired in tasks 4 and 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire post-sign in-person complete page

**Files:**
- Modify: `src/app/contracts/[id]/sign-in-person/complete/page.tsx:58-83`

Two swaps in the existing JSX block. Imports stay the same except for the new `sanitizePdfFilename` helper.

- [ ] **Step 1: Add filename helper import + compute filename**

In `src/app/contracts/[id]/sign-in-person/complete/page.tsx`, find the existing import block at lines 1-6 and add the helper import. Inside the function body, after `signedLabel` is computed (around line 46), add the filename derivation.

Replace lines 1-6 of the file (the existing import block) with:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Download, ArrowLeft, Eye } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { sanitizePdfFilename } from "@/lib/contracts/pdf-filename";
import type { Contract } from "@/lib/contracts/types";
```

After the `const signedLabel = ...` block, add:

```tsx
  const filename = `${sanitizePdfFilename(contract.title)}.pdf`;
```

- [ ] **Step 2: Swap the View link to in-app navigation**

Find the `<Link>` block currently rendering View signed PDF (lines 58-66 of the original file):

```tsx
        {contract.signed_pdf_path && (
          <Link
            href={`/api/contracts/${contract.id}/pdf?inline=1`}
            target="_blank"
            className="inline-flex items-center gap-2 text-sm text-[var(--brand-primary)] hover:underline mb-6"
          >
            <Eye size={14} /> View signed PDF
          </Link>
        )}
```

Replace with:

```tsx
        {contract.signed_pdf_path && (
          <Link
            href={`/contracts/${contract.id}/view`}
            className="inline-flex items-center gap-2 text-sm text-[var(--brand-primary)] hover:underline mb-6"
          >
            <Eye size={14} /> View signed PDF
          </Link>
        )}
```

- [ ] **Step 3: Add `download` attribute to the Download anchor**

Find the `<a>` at lines 75-82 of the original file:

```tsx
          {contract.signed_pdf_path && (
            <a
              href={`/api/contracts/${contract.id}/pdf`}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all"
            >
              <Download size={14} /> Download PDF
            </a>
          )}
```

Replace with:

```tsx
          {contract.signed_pdf_path && (
            <a
              href={`/api/contracts/${contract.id}/pdf`}
              download={filename}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all"
            >
              <Download size={14} /> Download PDF
            </a>
          )}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add src/app/contracts/[id]/sign-in-person/complete/page.tsx
git commit -m "$(cat <<'EOF'
fix(15h-followup): post-sign View PDF stays in app + Download → Files

Closes finding #2 (View popped to Safari → 401 from PWA cookie boundary)
and finding #3 (Download dead-ended in iOS inline viewer). View link now
routes to /contracts/[id]/view in-app; Download anchor gets the download
attribute so iOS 16+ Safari saves directly to Files.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire org-side contracts list

**Files:**
- Modify: `src/components/contracts/contracts-section.tsx:362-379`

Per-row View / Download buttons on a job page's contracts list have the identical bug. Same two swaps. The component is a client component (`"use client"` at the top per the import block check).

- [ ] **Step 1: Add filename helper import**

In `src/components/contracts/contracts-section.tsx`, locate the existing import for `cn` at line 24. Add the helper import on the next line:

```tsx
import { cn } from "@/lib/utils";
import { sanitizePdfFilename } from "@/lib/contracts/pdf-filename";
```

- [ ] **Step 2: Swap View + add download attribute on the per-row buttons**

Find the JSX block at lines 362-381 (the View / Download per-row buttons). The existing block:

```tsx
        {row.status === "signed" && row.signed_pdf_path && (
          <a
            href={`/api/contracts/${row.id}/pdf`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Download size={12} /> Download
          </a>
        )}
        {row.status === "signed" && (
          <Link
            href={`/api/contracts/${row.id}/pdf?inline=1`}
            target="_blank"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Eye size={12} /> View
          </Link>
        )}
```

Replace with:

```tsx
        {row.status === "signed" && row.signed_pdf_path && (
          <a
            href={`/api/contracts/${row.id}/pdf`}
            download={`${sanitizePdfFilename(row.title)}.pdf`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Download size={12} /> Download
          </a>
        )}
        {row.status === "signed" && (
          <Link
            href={`/contracts/${row.id}/view`}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Eye size={12} /> View
          </Link>
        )}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean exit. The `row.title` field is on `ContractListItem` (already imported at line 23).

- [ ] **Step 4: Commit**

```bash
git add src/components/contracts/contracts-section.tsx
git commit -m "$(cat <<'EOF'
fix(15h-followup): contracts list View → in-app + Download → Files

Same two-line fix as the post-sign success page, applied to the per-row
View / Download buttons on the job-page contracts list. View now routes
to /contracts/[id]/view in-app instead of popping target=_blank to
Safari (which breaks under PWA cookie boundary). Download gets the
download attribute for direct save to Files.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Build verify + push

**Files:** none modified.

- [ ] **Step 1: Final tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean exit; `/contracts/[id]/view` listed as a route in the build output.

- [ ] **Step 2: Confirm with Eric before pushing**

Surface to Eric: "Ready to push 5 commits (filename helper, viewer component, viewer page, post-sign call-site swap, contracts-list call-site swap). Push?"

Wait for explicit confirmation before running `git push`.

- [ ] **Step 3: Push**

After confirmation:

```bash
git push origin main
```

Vercel auto-deploy follows.

---

### Task 7: Live AAA-prod iPad smoke test

**Files:** none modified.

Eric drives this on his iPad in PWA standalone mode. Claude observes results and is ready to escalate to the Web Share fallback if `download` is ignored.

- [ ] **Step 1: Wait for Vercel deploy**

Watch Vercel etag flip on `aaaplatform.vercel.app/login` (mirrors the 15h verification pattern). Confirm deploy is live before the smoke begins.

- [ ] **Step 2: Smoke A — post-sign success page**

Eric: from a recent in-person-signed contract's `/contracts/[id]/sign-in-person/complete` URL on the iPad PWA:
1. Tap **View signed PDF** → expect to land on the new `/contracts/[id]/view` route in-app, PDF rendered inline, Back button visible.
2. Tap **Back** → returns to the job page.
3. Re-open the success page; tap **Download PDF** → expect a direct file save to iPad Files (no Safari inline viewer detour).

- [ ] **Step 3: Smoke B — contracts list on a job page**

Eric: on a job that has a signed contract, in the contracts section per-row buttons:
1. Tap **View** → in-app `/contracts/[id]/view` render.
2. Tap **Download** → direct save to Files.

- [ ] **Step 4: Desktop regression check**

On any browser (Eric's MacBook Chrome): tap View on a signed contract → in-app viewer renders, browser back works. Tap Download → file saves with the right filename.

- [ ] **Step 5: Decide on Share Sheet fallback**

If iPad smoke shows `download` is ignored under PWA standalone mode (file still preview-detours): file a follow-up issue describing a `navigator.share({ files: [...] })` handler. Do NOT extend this build's scope.

If smoke is clean: mark all four 15h findings as 50% closed (#1 + #2 + #3 done; #4 Chrome /sign hang remains).

---

### Task 8: Handoff

**Files:**
- Create: `docs/vault/handoffs/2026-05-08-build-15h-followup-ipad-pdf-access.md`
- Modify: `docs/vault/00-NOW.md` (prepend a new `last_verified` line; archive the prior one)

- [ ] **Step 1: Invoke `end-of-session-handoff` skill**

This generates the dated handoff doc and updates `00-NOW.md` per the project's handoff conventions.

- [ ] **Step 2: Commit the vault update**

The skill commits its own update; verify with `git status` after.

---

## Self-review

**Spec coverage:**
- Goals 1, 2, 3 → Tasks 2 + 3 (in-app render); Task 4 + 5 (call-site swaps); Task 4 + 5 (download attribute applied at both surfaces). ✓
- Non-goals respected: customer `/sign/[token]` not touched; finding #4 explicitly out of scope. ✓
- Architecture matches: new viewer route, new `<SignedPdfViewer>` component (separate from `PdfCanvas`), new shared filename helper. ✓
- Edge cases covered in Task 3: missing contract card, unsigned card, voided pill, auth redirect. ✓
- Out-of-scope items confirmed unchanged: `/api/contracts/[id]/pdf` route untouched. ✓

**Placeholder scan:**
- All file paths concrete; all code blocks complete; all commands runnable. No "TBD" / "TODO" / "implement later". ✓

**Type consistency:**
- `sanitizePdfFilename(title: string): string` defined in Task 1, called identically in Tasks 3, 4, 5.
- `<SignedPdfViewer>` props `{ pdfUrl: string }` defined in Task 2, used in Task 3 with `pdfUrl={...}` matching. ✓
- `Pick<Contract, ...>` type in Task 3 includes `void_reason` to match the conditional render in the header. ✓

No issues found.
