import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, ArrowLeft, FileText, Pencil } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requirePermission } from "@/lib/permissions-api";
import { getEstimateWithContents } from "@/lib/estimates";
import { formatCurrency } from "@/lib/format";
import { STATUS_BADGE_CLASSES, formatStatusLabel } from "@/lib/estimate-status";
import { ExportPdfButton } from "@/components/export-pdf-modal/button";
import { SendButton } from "@/components/send-modal/button";
import type {
  Contact,
  EstimateLineItem,
  Job,
} from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Local ErrorPage helper — mirrors the pattern in /estimates/[id]/edit/page.tsx
// ─────────────────────────────────────────────────────────────────────────────

interface ErrorPageProps {
  title: string;
  message: string;
  backHref: string;
  backLabel: string;
}

function ErrorPage({ title, message, backHref, backLabel }: ErrorPageProps) {
  return (
    <div className="flex items-center justify-center min-h-[40vh] px-4">
      <div className="rounded-xl border border-border bg-card p-8 text-center max-w-md w-full">
        <AlertCircle size={28} className="mx-auto text-destructive mb-3" />
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{message}</p>
        <Link
          href={backHref}
          className="inline-block mt-4 text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          {backLabel}
        </Link>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ItemsTable — inline helper; renders a section's line items as a simple table
// ─────────────────────────────────────────────────────────────────────────────

function ItemsTable({ items }: { items: EstimateLineItem[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium w-1/2">Description</th>
            <th className="py-1.5 pr-3 font-medium">Code</th>
            <th className="py-1.5 pr-3 font-medium text-right">Qty</th>
            <th className="py-1.5 pr-3 font-medium">Unit</th>
            <th className="py-1.5 pr-3 font-medium text-right">Unit Price</th>
            <th className="py-1.5 font-medium text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-3 text-foreground">{item.description}</td>
              <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                {item.code ?? "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {item.quantity}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {item.unit ?? "—"}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {formatCurrency(item.unit_price)}
              </td>
              <td className="py-2 text-right tabular-nums font-medium">
                {formatCurrency(item.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function EstimateViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  // 1. Permission check — must happen before any DB reads.
  const auth = await requirePermission(supabase, "view_estimates");
  if (!auth.ok) {
    return (
      <ErrorPage
        title="Access restricted"
        message="You don't have permission to view estimates."
        backHref="/jobs"
        backLabel="Back to jobs"
      />
    );
  }

  // 2. Fetch estimate with its sections + line items.
  const estimate = await getEstimateWithContents(id, supabase);
  if (!estimate) notFound();

  // 3. Fetch parent job with contact joined.
  //    Destructure error separately (Task 19 lesson).
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("*, contact:contacts(*)")
    .eq("id", estimate.job_id)
    .maybeSingle<Job & { contact: Contact | null }>();

  if (jobErr) {
    return (
      <ErrorPage
        title="Could not load job"
        message={jobErr.message}
        backHref="/jobs"
        backLabel="Back to jobs"
      />
    );
  }

  if (!job) notFound();

  // 4. Check edit permission for the conditional Edit button (server-side).
  const editAuth = await requirePermission(supabase, "edit_estimates");
  const canEdit = editAuth.ok;

  // ── Derived display values ─────────────────────────────────────────────────
  const isVoided = estimate.status === "voided";
  const statusLabel = formatStatusLabel(estimate.status);

  const contact = job.contact;
  const contactName = contact
    ? `${contact.first_name} ${contact.last_name}`.trim()
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* ── BACK LINK ───────────────────────────────────────────────────────── */}
      <Link
        href={`/jobs/${estimate.job_id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} />
        Back to job
      </Link>

      {/* ── VOIDED BANNER ───────────────────────────────────────────────────── */}
      {isVoided && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2 text-destructive font-medium">
          This estimate has been voided
          {estimate.void_reason && (
            <span className="font-normal"> — {estimate.void_reason}</span>
          )}
        </div>
      )}

      {/* ── HEADER ROW ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4">
        {/* Left: icon + number + badge + title */}
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText size={16} className="text-muted-foreground shrink-0" />
            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">
              {estimate.estimate_number}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[estimate.status]}`}
            >
              {statusLabel}
            </span>
          </div>
          <h1
            className={`text-xl font-semibold text-foreground ${
              isVoided ? "line-through text-muted-foreground" : ""
            }`}
          >
            {estimate.title}
          </h1>
        </div>

        {/* Right: Send + Export PDF + Edit button (if permitted) */}
        <div className="flex items-center gap-2 shrink-0">
          <SendButton
            mode="estimate"
            documentId={id}
            jobId={estimate.job_id}
            status={estimate.status}
          />
          <ExportPdfButton
            documentType="estimate"
            documentId={id}
            filenameHint={estimate.estimate_number}
          />
          {canEdit && (
            <Link
              href={`/estimates/${id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted transition-colors"
            >
              <Pencil size={14} />
              Edit
            </Link>
          )}
        </div>
      </div>

      {/* ── CUSTOMER BLOCK ──────────────────────────────────────────────────── */}
      {contact && (
        <div className="rounded-lg border border-border bg-card px-5 py-4 space-y-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            Customer
          </p>
          {contactName && (
            <p className="font-semibold text-foreground">{contactName}</p>
          )}
          {contact.company && (
            <p className="text-sm text-muted-foreground">{contact.company}</p>
          )}
          {job.property_address && (
            <p className="text-sm text-muted-foreground">
              {job.property_address}
            </p>
          )}
          {contact.email && (
            <p className="text-sm text-muted-foreground">{contact.email}</p>
          )}
          {contact.phone && (
            <p className="text-sm text-muted-foreground">{contact.phone}</p>
          )}
        </div>
      )}

      {/* ── METADATA ROW ────────────────────────────────────────────────────── */}
      {(estimate.issued_date || estimate.valid_until) && (
        <div className="flex gap-6 flex-wrap text-sm">
          {estimate.issued_date && (
            <div>
              <span className="text-muted-foreground">Issued: </span>
              <span className="font-medium text-foreground">
                {new Date(estimate.issued_date).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
          )}
          {estimate.valid_until && (
            <div>
              <span className="text-muted-foreground">Valid until: </span>
              <span className="font-medium text-foreground">
                {new Date(estimate.valid_until).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── OPENING STATEMENT ───────────────────────────────────────────────── */}
      {estimate.opening_statement && estimate.opening_statement.trim() && (
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
            Opening Statement
          </p>
          <div
            className="prose prose-sm max-w-none text-foreground"
            dangerouslySetInnerHTML={{ __html: estimate.opening_statement }}
          />
        </div>
      )}

      {/* ── SECTIONS LIST ───────────────────────────────────────────────────── */}
      {estimate.sections.length === 0 ? (
        <p className="italic text-muted-foreground text-sm">
          No line items on this estimate.
        </p>
      ) : (
        <div className="space-y-4">
          {estimate.sections.map((sec) => (
            <section
              key={sec.id}
              className="rounded-lg border border-border bg-card px-5 py-4 space-y-3"
            >
              <h3 className="text-base font-semibold text-foreground">
                {sec.title}
              </h3>

              {/* Direct items on the section */}
              {sec.items.length > 0 && <ItemsTable items={sec.items} />}

              {/* Nested subsections */}
              {sec.subsections.map((sub) => (
                <div key={sub.id} className="ml-4 space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    {sub.title}
                  </h4>
                  {sub.items.length > 0 && <ItemsTable items={sub.items} />}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      {/* ── CLOSING STATEMENT ───────────────────────────────────────────────── */}
      {estimate.closing_statement && estimate.closing_statement.trim() && (
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
            Closing Statement
          </p>
          <div
            className="prose prose-sm max-w-none text-foreground"
            dangerouslySetInnerHTML={{ __html: estimate.closing_statement }}
          />
        </div>
      )}

      {/* ── TOTALS STACK ────────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card px-5 py-4 space-y-2 text-sm">
          {/* Subtotal */}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatCurrency(estimate.subtotal)}</span>
          </div>

          {/* Markup row — only when markup_type !== "none" */}
          {estimate.markup_type !== "none" && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Markup (
                {estimate.markup_type === "percent"
                  ? `${estimate.markup_value}%`
                  : formatCurrency(estimate.markup_value)}
                )
              </span>
              <span className="tabular-nums">
                {formatCurrency(estimate.markup_amount)}
              </span>
            </div>
          )}

          {/* Discount row — only when discount_type !== "none" */}
          {estimate.discount_type !== "none" && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Discount (
                {estimate.discount_type === "percent"
                  ? `${estimate.discount_value}%`
                  : formatCurrency(estimate.discount_value)}
                )
              </span>
              <span className="tabular-nums text-destructive">
                −{formatCurrency(estimate.discount_amount)}
              </span>
            </div>
          )}

          {/* Adjusted subtotal — show when there's a markup or discount */}
          {(estimate.markup_type !== "none" ||
            estimate.discount_type !== "none") && (
            <div className="flex justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Adjusted subtotal</span>
              <span className="tabular-nums">
                {formatCurrency(estimate.adjusted_subtotal)}
              </span>
            </div>
          )}

          {/* Tax row */}
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Tax ({estimate.tax_rate}%)
            </span>
            <span className="tabular-nums">
              {formatCurrency(estimate.tax_amount)}
            </span>
          </div>

          {/* Total */}
          <div className="flex justify-between border-t border-border pt-2">
            <span className="font-semibold text-foreground text-base">Total</span>
            <span className="tabular-nums font-bold text-base text-foreground">
              {formatCurrency(estimate.total)}
            </span>
          </div>

          {/* Negative total warning */}
          {estimate.total < 0 && (
            <p className="text-xs text-muted-foreground italic">
              Note: total is negative — check markup and discount values.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
