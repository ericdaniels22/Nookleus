"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { escapeOrFilterValue } from "@/lib/postgrest";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Job, JobAdjuster, Contact, JobActivity, Payment, Invoice, Photo, PhotoTag, PhotoReport, Email } from "@/lib/types";
import { photoUrl } from "@/lib/jobs/photo-url";
import { formatPhoneNumber, normalizePhoneToE164 } from "@/lib/phone";
import { OFFICIAL_INVOICE_STATUSES } from "@/lib/invoice-status";
import FinancialsTab from "@/components/job-detail/financials-tab";
import { EstimatesInvoicesSection } from "@/components/job-detail/estimates-invoices-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import ActivityTimeline from "@/components/activity-timeline";
import PhotoUploadModal from "@/components/photo-upload";
import PhotoDetailModal from "@/components/photo-detail";
import PhotoAnnotator from "@/components/photo-annotator";
import ComposeEmailModal from "@/components/compose-email";
import { JobEmailRow } from "@/components/email/job-email-row";
import { buildQuotedReply } from "@/components/email/build-quoted-reply";
import JarvisJobPanel from "@/components/jarvis/JarvisJobPanel";
import JobFiles from "@/components/job-files";
import ContractsSection from "@/components/contracts/contracts-section";
import CaptureFab from "@/components/mobile/capture-fab";
import InsuranceCompanyPicker from "@/components/insurance-company-picker";
import ReferrerPicker, {
  type ReferrerPickerPartner,
} from "@/components/referral-partners/referrer-picker";
import {
  MapPin,
  Home,
  Layers,
  Ruler,
  KeyRound,
  Phone,
  Mail,
  Building,
  FileText,
  User,
  ArrowLeft,
  Droplets,
  Pencil,
  Send,
  Loader2,
  Copy,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { canDeleteJobs } from "@/lib/jobs/auth";
import {
  statusColors,
  statusLabels,
  urgencyColors,
  urgencyLabels,
  damageTypeColors,
  damageTypeLabels,
} from "@/lib/badge-colors";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import JobPhotosTab from "@/components/job-photos-tab";
import { useAuth } from "@/lib/auth-context";

const propertyTypeLabels: Record<string, string> = {
  single_family: "Single Family",
  multi_family: "Multi Family",
  commercial: "Commercial",
  condo: "Condo",
};

export default function JobDetail({ jobId }: { jobId: string }) {
  const { hasPermission, profile } = useAuth();
  const showJobDeleteAffordances = canDeleteJobs(profile?.role);
  const [job, setJob] = useState<Job | null>(null);
  const [activities, setActivities] = useState<JobActivity[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expensesTotal, setExpensesTotal] = useState<number>(0);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [tags, setTags] = useState<PhotoTag[]>([]);
  const [reports, setReports] = useState<PhotoReport[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [stripeConnected, setStripeConnected] = useState(false);
  const [customFields, setCustomFields] = useState<{ field_key: string; field_value: string }[]>([]);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDefaults, setComposeDefaults] = useState({ to: "", subject: "", body: "", replyToMessageId: "" });
  const [loading, setLoading] = useState(true);
  const [photoUploadOpen, setPhotoUploadOpen] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [annotatorOpen, setAnnotatorOpen] = useState(false);
  const [annotatorPhoto, setAnnotatorPhoto] = useState<Photo | null>(null);
  const [annotatorUrl, setAnnotatorUrl] = useState("");
  const [editJobOpen, setEditJobOpen] = useState(false);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [editInsuranceOpen, setEditInsuranceOpen] = useState(false);
  const [addAdjusterOpen, setAddAdjusterOpen] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [pendingReminderTotal, setPendingReminderTotal] = useState(0);
  const [editingCrewLabor, setEditingCrewLabor] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = searchParams.get("tab") || "overview";

  const setActiveTab = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    const [jobRes, activitiesRes, paymentsRes, invoicesRes, photosRes, photoCountRes, tagsRes, reportsRes, emailsRes] = await Promise.all([
      supabase
        .from("jobs")
        .select("*, contact:contacts!contact_id(*), insurance_contact:contacts!insurance_contact_id(*), referral_partner:referral_partners!referral_partner_id(id, company_name), job_adjusters(*, adjuster:contacts!contact_id(*))")
        .eq("id", jobId)
        .single(),
      supabase
        .from("job_activities")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
      supabase
        .from("payments")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
      supabase
        .from("invoices")
        .select("id, invoice_number, title, total_amount, status")
        .eq("job_id", jobId)
        .is("deleted_at", null)
        .in("status", [...OFFICIAL_INVOICE_STATUSES]),
      supabase
        .from("photos")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("photos")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId),
      supabase.from("photo_tags").select("*").order("name"),
      supabase
        .from("photo_reports")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
      supabase
        .from("emails")
        .select("*, attachments:email_attachments(*)")
        .eq("job_id", jobId)
        .order("received_at", { ascending: false }),
    ]);

    if (jobRes.data) setJob(jobRes.data as Job);
    if (activitiesRes.data) setActivities(activitiesRes.data as JobActivity[]);
    if (paymentsRes.data) setPayments(paymentsRes.data as Payment[]);
    if (invoicesRes.data) setInvoices(invoicesRes.data as Invoice[]);
    if (photosRes.data) setPhotos(photosRes.data as Photo[]);
    if (photoCountRes.count != null) setPhotoCount(photoCountRes.count);
    if (tagsRes.data) setTags(tagsRes.data as PhotoTag[]);
    if (reportsRes.data) setReports(reportsRes.data as PhotoReport[]);
    if (emailsRes.data) setEmails(emailsRes.data as Email[]);

    // Fetch custom fields
    const { data: cfData } = await supabase
      .from("job_custom_fields")
      .select("field_key, field_value")
      .eq("job_id", jobId);
    if (cfData) setCustomFields(cfData);

    // Fetch Stripe connection state (for Online Payment Requests subsection)
    const { data: stripeConn } = await supabase
      .from("stripe_connection")
      .select("id")
      .limit(1)
      .maybeSingle();
    setStripeConnected(!!stripeConn);

    // Fetch expenses total for summary pills
    const { data: expData } = await supabase
      .from("expenses")
      .select("amount")
      .eq("job_id", jobId);
    if (expData) {
      setExpensesTotal(expData.reduce((sum: number, e: { amount: number }) => sum + Number(e.amount), 0));
    }

    // Aggregate reminder count across any sent/viewed contracts for the
    // "· N reminders sent" indicator next to the Awaiting-signature pill.
    const { data: pendingContracts } = await supabase
      .from("contracts")
      .select("reminder_count")
      .eq("job_id", jobId)
      .in("status", ["sent", "viewed"]);
    if (pendingContracts) {
      setPendingReminderTotal(
        pendingContracts.reduce(
          (sum: number, c: { reminder_count: number | null }) => sum + (c.reminder_count ?? 0),
          0,
        ),
      );
    } else {
      setPendingReminderTotal(0);
    }

    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Redirect legacy billing deep-links to new Financials tab
  useEffect(() => {
    const section = searchParams.get("section");
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (section === "billing" || hash === "#billing") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("section");
      params.set("tab", "financials");
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [searchParams, router]);

  async function updateStatus(newStatus: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("jobs")
      .update({ status: newStatus })
      .eq("id", jobId);

    if (error) {
      toast.error("Failed to update status.");
    } else {
      toast.success(`Status updated to ${statusLabels[newStatus]}.`);
      fetchData();
    }
  }

  async function moveJobToTrash() {
    if (!confirm("Move this job to the trash? You'll have 30 days to restore it before it's permanently deleted.")) {
      return;
    }
    const res = await fetch(`/api/jobs/${jobId}/delete`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't move job to trash.");
      return;
    }
    toast.success("Job moved to trash.");
    router.push("/jobs");
  }

  async function restoreJob() {
    const res = await fetch(`/api/jobs/${jobId}/restore`, { method: "POST" });
    if (!res.ok) {
      toast.error("Couldn't restore job.");
      return;
    }
    toast.success("Job restored.");
    fetchData();
  }

  async function saveCrewLabor(raw: string) {
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      setEditingCrewLabor(false);
      return;
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("jobs")
      .update({ estimated_crew_labor_cost: value })
      .eq("id", jobId);
    setEditingCrewLabor(false);
    if (!error) {
      fetchData();
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground/60">Loading job...</div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground text-lg">Job not found.</p>
        <Link href="/jobs" className="text-primary text-sm hover:underline mt-2 inline-block">
          Back to jobs
        </Link>
      </div>
    );
  }

  const contactName = job.contact ? job.contact.full_name : "Unknown";

  return (
    <div className="max-w-6xl animate-fade-slide-up">
      <CaptureFab jobId={jobId} />
      {/* Back link */}
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft size={16} />
        Back to Jobs
      </Link>

      {/* Trash banner */}
      {job.deleted_at && (
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
          <div className="text-sm text-foreground">
            <span className="font-semibold text-destructive">In trash · </span>
            Moved on {format(new Date(job.deleted_at), "MMM d, yyyy")}. Permanently deleted after 30 days.
          </div>
          {showJobDeleteAffordances && (
            <button
              type="button"
              onClick={restoreJob}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent shrink-0"
            >
              <RotateCcw size={14} />
              Restore
            </button>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-sm font-mono text-muted-foreground/60">{job.job_number}</p>
          <h1 className="text-2xl font-bold text-foreground">{contactName}</h1>
          <div className="flex items-center gap-2 mt-2">
            <Badge
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-md",
                urgencyColors[job.urgency]
              )}
            >
              {urgencyLabels[job.urgency]}
            </Badge>
            <Badge
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-md",
                damageTypeColors[job.damage_type]
              )}
            >
              {damageTypeLabels[job.damage_type]}
            </Badge>
            <Badge
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-md",
                statusColors[job.status]
              )}
            >
              {statusLabels[job.status]}
            </Badge>
            {job.has_signed_contract ? (
              <Badge
                className="text-xs font-medium px-2 py-0.5 rounded-md bg-[rgba(29,158,117,0.12)] text-[#5DCAA5] border border-[rgba(29,158,117,0.35)]"
              >
                Contract signed
              </Badge>
            ) : job.has_pending_contract ? (
              <>
                <Badge
                  className="text-xs font-medium px-2 py-0.5 rounded-md bg-[rgba(239,159,39,0.12)] text-[#FAC775] border border-[rgba(239,159,39,0.3)]"
                >
                  Awaiting signature
                </Badge>
                {pendingReminderTotal > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    · {pendingReminderTotal} reminder{pendingReminderTotal === 1 ? "" : "s"} sent
                  </span>
                )}
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <JarvisJobPanel
            jobId={jobId}
            jobContext={{
              customerName: contactName,
              address: job.property_address,
              status: job.status,
              damageType: job.damage_type,
            }}
          />
          <select
            value={job.status}
            onChange={(e) => updateStatus(e.target.value)}
            className="w-[180px] rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          >
            <option value="new">New</option>
            <option value="in_progress">In Progress</option>
            <option value="pending_invoice">Pending Invoice</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          {showJobDeleteAffordances && !job.deleted_at && (
            <button
              type="button"
              onClick={moveJobToTrash}
              aria-label="Move job to trash"
              title="Move to trash"
              className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b-2 border-border mb-6">
        <button
          onClick={() => setActiveTab("overview")}
          className={cn(
            "px-6 py-2.5 text-sm font-medium -mb-[2px] border-b-2 transition-colors",
            activeTab === "overview"
              ? "text-[#2B5EA7] border-[#2B5EA7] font-semibold"
              : "text-muted-foreground border-transparent hover:text-foreground"
          )}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab("financials")}
          className={cn(
            "px-6 py-2.5 text-sm font-medium -mb-[2px] border-b-2 transition-colors",
            activeTab === "financials"
              ? "text-[#2B5EA7] border-[#2B5EA7] font-semibold"
              : "text-muted-foreground border-transparent hover:text-foreground"
          )}
        >
          Financials
        </button>
        <button
          onClick={() => setActiveTab("photos")}
          className={cn(
            "px-6 py-2.5 text-sm font-medium -mb-[2px] border-b-2 transition-colors flex items-center gap-1.5",
            activeTab === "photos"
              ? "text-[#2B5EA7] border-[#2B5EA7] font-semibold"
              : "text-muted-foreground border-transparent hover:text-foreground"
          )}
        >
          Photos
          <span className={cn(
            "text-[11px] px-1.5 py-0 rounded-full",
            activeTab === "photos"
              ? "bg-[#dbeafe] text-[#2B5EA7]"
              : "bg-muted text-muted-foreground"
          )}>
            {photoCount}
          </span>
        </button>
      </div>

      {activeTab === "financials" && (() => {
        const collected = payments
          .filter((p) => p.status === "received")
          .reduce((sum, p) => sum + Number(p.amount), 0);
        // `invoices` is fetched official-only (sent/partial/paid), so this is
        // the official Invoiced total — drafts/voided are never summed.
        const invoiced = invoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
        const crewLabor = job.estimated_crew_labor_cost ?? 0;
        const gross_margin = collected - expensesTotal - crewLabor;
        const margin_pct = collected > 0 ? (gross_margin / collected) * 100 : null;
        return (
          <FinancialsTab
            jobId={jobId}
            payments={payments}
            invoices={invoices}
            summary={{
              invoiced,
              collected,
              expenses: expensesTotal,
              gross_margin,
              margin_pct,
              in_progress: job.status !== "completed",
            }}
            onPaymentRecorded={fetchData}
            onExpenseLogged={fetchData}
            stripeConnected={stripeConnected}
          />
        );
      })()}

      {activeTab === "overview" && (
      <>
      {/* Info card — 3 columns */}
      <div className="rounded-xl border border-border bg-card p-6 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1px_1fr_1px_1fr] gap-0">
          {/* Column 1: Job Info */}
          <div className="pr-0 lg:pr-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground">Job Info</h3>
              <button
                onClick={() => setEditJobOpen(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Edit Job Info"
              >
                <Pencil size={14} />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <AddressRow address={job.property_address} />
              {job.property_type && (
                <InfoRow
                  icon={Home}
                  label="Property Type"
                  value={propertyTypeLabels[job.property_type] || job.property_type}
                />
              )}
              {job.damage_source && (
                <InfoRow icon={Droplets} label="Damage Source" value={job.damage_source} />
              )}
              {job.affected_areas && (
                <InfoRow icon={MapPin} label="Affected Areas" value={job.affected_areas} />
              )}
              <InfoRow
                icon={FileText}
                label="Intake Date"
                value={format(new Date(job.created_at), "MMM d, yyyy 'at' h:mm a")}
              />
              {job.referral_partner && (
                <div className="flex items-start gap-3">
                  <User size={16} className="text-primary/60 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">Referred by</p>
                    <Link
                      href={`/referral-partners/${job.referral_partner.id}`}
                      className="text-foreground hover:underline"
                    >
                      {job.referral_partner.company_name} →
                    </Link>
                  </div>
                </div>
              )}
              {/* Estimated crew labor cost — inline edit gated by edit_jobs */}
              <div className="flex items-start gap-3">
                <Layers size={16} className="text-primary/60 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Estimated crew labor cost</p>
                  {editingCrewLabor && hasPermission("edit_jobs") ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={job.estimated_crew_labor_cost ?? ""}
                      onBlur={(e) => saveCrewLabor(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") { setEditingCrewLabor(false); }
                      }}
                      autoFocus
                      className="rounded bg-neutral-800 px-2 py-0.5 text-right w-32 text-sm text-foreground"
                    />
                  ) : job.estimated_crew_labor_cost !== null && job.estimated_crew_labor_cost !== undefined ? (
                    <button
                      type="button"
                      disabled={!hasPermission("edit_jobs")}
                      onClick={() => setEditingCrewLabor(true)}
                      className="text-foreground hover:underline disabled:cursor-default disabled:hover:no-underline"
                    >
                      {Number(job.estimated_crew_labor_cost).toLocaleString("en-US", { style: "currency", currency: "USD" })}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!hasPermission("edit_jobs")}
                      onClick={() => setEditingCrewLabor(true)}
                      className="text-muted-foreground italic hover:underline disabled:cursor-default disabled:hover:no-underline"
                    >
                      Not set
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="hidden lg:block bg-border/50" />

          {/* Column 2: Contact + Adjusters */}
          <div className="px-0 lg:px-6 pt-6 lg:pt-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground">Contact</h3>
              <button
                onClick={() => setEditContactOpen(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Edit Contact"
              >
                <Pencil size={14} />
              </button>
            </div>

            {/* Condensed homeowner card */}
            {job.contact && (
              <div className="rounded-lg border border-border bg-background/50 p-3 mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground">
                    {job.contact.full_name}
                  </span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 uppercase">
                    {job.contact.role === "property_manager" ? "Prop Manager" : job.contact.role}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {[formatPhoneNumber(job.contact.phone || ""), job.contact.email].filter(Boolean).join(" \u00b7 ")}
                </p>
              </div>
            )}

            {/* Adjusters sub-section */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Adjusters</span>
                <button
                  onClick={() => setAddAdjusterOpen(true)}
                  className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  title="Add Adjuster"
                >
                  +
                </button>
              </div>
              {(job.job_adjusters && job.job_adjusters.length > 0) ? (
                <div className="space-y-2">
                  {[...job.job_adjusters]
                    .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
                    .map((ja) => (
                      <AdjusterCard key={ja.id} jobAdjuster={ja} jobId={jobId} onUpdated={fetchData} />
                    ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/60 py-2">No adjusters assigned</p>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="hidden lg:block bg-border/50" />

          {/* Column 3: Insurance + HOA */}
          <div className="pl-0 lg:pl-6 pt-6 lg:pt-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground">Insurance</h3>
              <button
                onClick={() => setEditInsuranceOpen(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Edit Insurance"
              >
                <Pencil size={14} />
              </button>
            </div>

            {/* Insurance card */}
            {(job.insurance_company || job.claim_number || job.policy_number) ? (
              <div className="rounded-lg border border-border bg-background/50 p-3 mb-3">
                {job.insurance_company && (
                  <p className="text-sm font-medium text-foreground mb-1">{job.insurance_company}</p>
                )}
                {job.insurance_contact?.email && (
                  <a
                    href={`mailto:${job.insurance_contact.email}`}
                    className="block text-xs text-primary hover:underline mb-1"
                  >
                    {job.insurance_contact.email}
                  </a>
                )}
                <p className="text-xs text-muted-foreground">
                  {[
                    job.claim_number ? `Claim: ${job.claim_number}` : null,
                    job.policy_number ? `Policy: ${job.policy_number}` : null,
                  ].filter(Boolean).join(" \u00b7 ")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {[
                    job.date_of_loss ? `DOL: ${format(new Date(job.date_of_loss), "MMM d, yyyy")}` : null,
                    job.deductible != null ? `Deductible: $${Number(job.deductible).toLocaleString()}` : null,
                  ].filter(Boolean).join(" \u00b7 ")}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60 py-2">No insurance info</p>
            )}

            {/* Payer type badge */}
            {job.payer_type && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Payer:</span>
                <PayerTypeBadge value={job.payer_type} />
              </div>
            )}

            {/* HOA sub-section */}
            <div className="mt-4">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">HOA</span>
              {(job.hoa_name || job.hoa_contact_name) ? (
                <div className="rounded-lg border border-border bg-background/50 p-3 mt-2">
                  {job.hoa_name && (
                    <p className="text-sm font-medium text-foreground mb-1">{job.hoa_name}</p>
                  )}
                  {job.hoa_contact_name && (
                    <p className="text-xs text-muted-foreground">
                      {[job.hoa_contact_name, formatPhoneNumber(job.hoa_contact_phone || "")].filter(Boolean).join(" \u00b7 ")}
                    </p>
                  )}
                  {job.hoa_contact_email && (
                    <p className="text-xs text-muted-foreground mt-0.5">{job.hoa_contact_email}</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground/60 py-2">No HOA info</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Job Info Dialog */}
      <EditJobInfoDialog
        open={editJobOpen}
        onOpenChange={setEditJobOpen}
        job={job}
        jobId={jobId}
        onSaved={fetchData}
      />

      {/* Edit Contact Dialog */}
      <EditContactDialog
        open={editContactOpen}
        onOpenChange={setEditContactOpen}
        job={job}
        jobId={jobId}
        onSaved={fetchData}
      />

      {/* Edit Insurance Dialog */}
      <EditInsuranceDialog
        open={editInsuranceOpen}
        onOpenChange={setEditInsuranceOpen}
        job={job}
        jobId={jobId}
        onSaved={fetchData}
      />

      {/* Add Adjuster Dialog */}
      <AddAdjusterDialog
        open={addAdjusterOpen}
        onOpenChange={setAddAdjusterOpen}
        jobId={jobId}
        existingAdjusterIds={(job.job_adjusters || []).map((ja) => ja.contact_id)}
        onSaved={fetchData}
      />

      <EstimatesInvoicesSection jobId={jobId} />

      <JobFiles jobId={jobId} />

      <ContractsSection
        jobId={jobId}
        customerName={job.contact?.full_name ?? null}
        customerEmail={job.contact?.email ?? null}
        onChanged={fetchData}
      />

      {/* Reports */}
      {reports.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">
              <FileText size={16} className="inline mr-2 -mt-0.5" />
              Reports ({reports.length})
            </h3>
            <Link
              href={`/reports/new?jobId=${jobId}`}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 border border-gray-200 bg-white text-primary hover:bg-[#E8F0FE] transition-colors gap-1.5"
            >
              <FileText size={14} />
              New Report
            </Link>
          </div>
          <div className="space-y-2">
            {reports.map((report) => (
              <Link
                key={report.id}
                href={`/reports/${report.id}`}
                className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-border hover:bg-accent/50 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                      report.status === "generated"
                        ? "bg-primary/10"
                        : "bg-vibrant-purple/10"
                    )}
                  >
                    <FileText
                      size={14}
                      className={
                        report.status === "generated"
                          ? "text-primary"
                          : "text-vibrant-purple"
                      }
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {report.title}
                    </p>
                    <p className="text-xs text-muted-foreground/60">
                      {format(new Date(report.report_date), "MMM d, yyyy")}
                    </p>
                  </div>
                </div>
                <Badge
                  className={cn(
                    "text-[10px] px-1.5 py-0 rounded capitalize flex-shrink-0",
                    report.status === "generated"
                      ? "bg-[#E1F5EE] text-[#085041]"
                      : "bg-[#F3F0FF] text-[#5B4DB5]"
                  )}
                >
                  {report.status}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Emails */}
      <div className="bg-card rounded-xl border border-border p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">
            <Mail size={16} className="inline mr-2 -mt-0.5" />
            Emails ({emails.length})
          </h3>
          <button
            onClick={() => {
              const primaryAdj = (job.job_adjusters || []).find((ja) => ja.is_primary)?.adjuster;
              const defaultTo = job.contact?.email || primaryAdj?.email || "";
              const defaultSubject = job.job_number ? `Re: ${job.job_number}` : "";
              setComposeDefaults({ to: defaultTo, subject: defaultSubject, body: "", replyToMessageId: "" });
              setComposeOpen(true);
            }}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-colors gap-1.5"
          >
            <Send size={14} />
            Send Email
          </button>
        </div>
        <ComposeEmailModal
          open={composeOpen}
          onOpenChange={setComposeOpen}
          jobId={jobId}
          defaultTo={composeDefaults.to}
          defaultSubject={composeDefaults.subject}
          defaultBody={composeDefaults.body}
          replyToMessageId={composeDefaults.replyToMessageId || undefined}
          onSent={fetchData}
        />
        {emails.length > 0 && (
          <div className="space-y-2">
            {emails.map((email) => (
              <JobEmailRow
                key={email.id}
                email={email}
                isExpanded={expandedEmailId === email.id}
                onToggle={() => setExpandedEmailId(expandedEmailId === email.id ? null : email.id)}
                onReply={() => {
                  const isSent = email.folder === "sent" || email.folder === "drafts";
                  const replyTo = isSent ? (email.to_addresses?.[0]?.email || "") : email.from_address;
                  const replySubject = email.subject.startsWith("Re:") ? email.subject : "Re: " + email.subject;
                  setComposeDefaults({
                    to: replyTo,
                    subject: replySubject,
                    body: buildQuotedReply(email),
                    replyToMessageId: email.message_id,
                  });
                  setComposeOpen(true);
                }}
              />
            ))}
          </div>
        )}
        {emails.length === 0 && (
          <div className="text-center py-6">
            <Mail size={32} className="mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground/60">No emails linked to this job yet.</p>
            <p className="text-xs text-muted-foreground/40 mt-1">
              Sync your email or send one using the button above.
            </p>
          </div>
        )}
      </div>

      {/* Custom Fields */}
      {customFields.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-5 mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-3">Custom Fields</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {customFields.map((cf) => (
              <div key={cf.field_key}>
                <p className="text-xs font-medium text-muted-foreground/60 capitalize">
                  {cf.field_key.replace(/_/g, " ").replace(/^custom /, "")}
                </p>
                <p className="text-sm text-foreground">{cf.field_value || "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Timeline */}
      <ActivityTimeline
        activities={activities}
        jobId={jobId}
        onActivityAdded={fetchData}
      />
      </>
      )}

      {activeTab === "photos" && (
        <JobPhotosTab
          jobId={jobId}
          tags={tags}
          supabaseUrl={supabaseUrl}
          coverPhotoId={job?.cover_photo_id ?? null}
          onPhotosAdded={fetchData}
          onPhotoUpdated={fetchData}
          onCoverPhotoChanged={fetchData}
          onSelectPhoto={(photo) => setSelectedPhoto(photo)}
        />
      )}

      {/* Photo modals — always rendered regardless of tab */}
      <PhotoUploadModal
        open={photoUploadOpen}
        onOpenChange={setPhotoUploadOpen}
        jobId={jobId}
        tags={tags}
        onPhotosAdded={fetchData}
      />
      <PhotoDetailModal
        open={!!selectedPhoto}
        onOpenChange={(open) => {
          if (!open) setSelectedPhoto(null);
        }}
        photo={selectedPhoto}
        allTags={tags}
        photoUrl={
          selectedPhoto ? photoUrl(selectedPhoto, supabaseUrl, "full") : ""
        }
        onUpdated={() => {
          setSelectedPhoto(null);
          fetchData();
        }}
        onAnnotate={(photo, url) => {
          setAnnotatorPhoto(photo);
          setAnnotatorUrl(url);
          setSelectedPhoto(null);
          setAnnotatorOpen(true);
        }}
      />
      <PhotoAnnotator
        open={annotatorOpen}
        onOpenChange={(val) => {
          setAnnotatorOpen(val);
          if (!val) {
            setAnnotatorPhoto(null);
            setAnnotatorUrl("");
          }
        }}
        photos={photos}
        initialPhotoIndex={photos.findIndex((p) => p.id === annotatorPhoto?.id)}
        onSaved={fetchData}
      />
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon size={16} className="text-primary/60 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-foreground">{value}</p>
      </div>
    </div>
  );
}

function AddressRow({ address }: { address: string }) {
  async function handleCopy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy address");
    }
  }
  return (
    <div className="flex items-start gap-3">
      <MapPin size={16} className="text-primary/60 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">Address</p>
        <p className="text-foreground break-words">{address}</p>
      </div>
      {address && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy address"
          title="Copy address"
          className="p-1.5 -mt-0.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
        >
          <Copy size={14} />
        </button>
      )}
    </div>
  );
}

function AdjusterCard({
  jobAdjuster,
  jobId,
  onUpdated,
}: {
  jobAdjuster: JobAdjuster;
  jobId: string;
  onUpdated: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const adj = jobAdjuster.adjuster;
  if (!adj) return null;

  const handleSetPrimary = async () => {
    const supabase = createClient();
    await supabase.from("job_adjusters").update({ is_primary: false }).eq("job_id", jobId);
    await supabase.from("job_adjusters").update({ is_primary: true }).eq("id", jobAdjuster.id);
    setMenuOpen(false);
    onUpdated();
  };

  const handleRemove = async () => {
    const supabase = createClient();
    await supabase.from("job_adjusters").delete().eq("id", jobAdjuster.id);
    setMenuOpen(false);
    onUpdated();
  };

  return (
    <div className="rounded-lg border border-border bg-background/50 p-3 group relative">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-foreground">
          {adj.full_name}
        </span>
        <div className="flex items-center gap-1.5">
          {jobAdjuster.is_primary && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase">
              Primary
            </span>
          )}
          <div className="relative">
            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setMenuOpen(!menuOpen)}>
              <span className="text-muted-foreground text-xs">&bull;&bull;&bull;</span>
            </Button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[140px]">
                {!jobAdjuster.is_primary && (
                  <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent text-foreground" onClick={handleSetPrimary}>
                    Set as Primary
                  </button>
                )}
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent text-destructive" onClick={handleRemove}>
                  Remove
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{[adj.title, adj.company].filter(Boolean).join(" \u00b7 ")}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{[formatPhoneNumber(adj.phone || ""), adj.email].filter(Boolean).join(" \u00b7 ")}</p>
    </div>
  );
}

/* ── Edit Job Info Dialog ── */

function EditJobInfoDialog({
  open,
  onOpenChange,
  job,
  jobId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  jobId: string;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    property_address: "",
    property_type: "" as string,
    property_sqft: "" as string,
    property_stories: "" as string,
    damage_source: "",
    affected_areas: "",
    access_notes: "",
  });
  const [referralPartnerId, setReferralPartnerId] = useState<string | null>(null);
  const [partners, setPartners] = useState<ReferrerPickerPartner[]>([]);

  useEffect(() => {
    if (open) {
      setForm({
        property_address: job.property_address || "",
        property_type: job.property_type || "",
        property_sqft: job.property_sqft ? String(job.property_sqft) : "",
        property_stories: job.property_stories ? String(job.property_stories) : "",
        damage_source: job.damage_source || "",
        affected_areas: job.affected_areas || "",
        access_notes: job.access_notes || "",
      });
      setReferralPartnerId(job.referral_partner_id ?? null);
    }
  }, [open, job]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("referral_partners")
        .select("id, company_name, status, deleted_at")
        .is("deleted_at", null)
        .order("company_name", { ascending: true });
      if (!cancelled && data) {
        setPartners(data as ReferrerPickerPartner[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handlePromoteAndPick(partnerId: string) {
    // Two writes, both hitting the server (per ADR-0002): flip the partner
    // to green via PATCH /api/referral-partners/[id], then attach via the
    // dialog's normal save. We optimistically update local state so the
    // picker shows the row as pickable immediately on close-and-reopen.
    const res = await fetch(`/api/referral-partners/${partnerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "green" }),
    });
    if (!res.ok) {
      toast.error("Couldn't promote the Target — try again.");
      return;
    }
    setPartners((prev) =>
      prev.map((p) => (p.id === partnerId ? { ...p, status: "green" } : p)),
    );
    setReferralPartnerId(partnerId);
  }

  async function handleSave() {
    if (!form.property_address.trim()) {
      toast.error("Address is required.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("jobs")
      .update({
        property_address: form.property_address.trim(),
        property_type: form.property_type || null,
        property_sqft: form.property_sqft ? Number(form.property_sqft) : null,
        property_stories: form.property_stories ? Number(form.property_stories) : null,
        damage_source: form.damage_source.trim() || null,
        affected_areas: form.affected_areas.trim() || null,
        access_notes: form.access_notes.trim() || null,
      })
      .eq("id", jobId);

    if (error) {
      toast.error("Failed to update job info.");
      setSaving(false);
      return;
    }

    // Referral-partner FK goes through the API route so eligibility is
    // enforced server-side (ADR-0002). Only PATCH when it actually
    // changed; an unchanged value skips the round-trip.
    if (referralPartnerId !== (job.referral_partner_id ?? null)) {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referral_partner_id: referralPartnerId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to update referrer.");
        setSaving(false);
        return;
      }
    }

    toast.success("Job info updated.");
    onOpenChange(false);
    onSaved();
    setSaving(false);
  }

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Job Info</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Address *</label>
            <Input value={form.property_address} onChange={(e) => update("property_address", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Property Type</label>
              <select
                value={form.property_type}
                onChange={(e) => update("property_type", e.target.value)}
                className="w-full h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
              >
                <option value="">Select...</option>
                <option value="single_family">Single Family</option>
                <option value="multi_family">Multi Family</option>
                <option value="commercial">Commercial</option>
                <option value="condo">Condo</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Sq Ft</label>
              <Input type="number" value={form.property_sqft} onChange={(e) => update("property_sqft", e.target.value)} placeholder="e.g. 2400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Stories</label>
              <Input type="number" value={form.property_stories} onChange={(e) => update("property_stories", e.target.value)} placeholder="e.g. 2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Damage Source</label>
              <Input value={form.damage_source} onChange={(e) => update("damage_source", e.target.value)} placeholder="e.g. Burst pipe" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Affected Areas</label>
            <Input value={form.affected_areas} onChange={(e) => update("affected_areas", e.target.value)} placeholder="e.g. Kitchen, hallway" />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Access Notes</label>
            <Textarea value={form.access_notes} onChange={(e) => update("access_notes", e.target.value)} rows={2} placeholder="Gate code, lockbox, etc." />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Referrer</label>
            <ReferrerPicker
              partners={partners}
              value={referralPartnerId}
              onChange={setReferralPartnerId}
              onPromoteAndPick={handlePromoteAndPick}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="gradient" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Edit Contact Dialog ── */

function EditContactDialog({
  open,
  onOpenChange,
  job,
  jobId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  jobId: string;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    role: "homeowner" as string,
  });

  useEffect(() => {
    if (open && job.contact) {
      setForm({
        full_name: job.contact.full_name || "",
        phone: formatPhoneNumber(job.contact.phone || ""),
        email: job.contact.email || "",
        role: job.contact.role || "homeowner",
      });
    }
  }, [open, job.contact]);

  async function handleSave() {
    if (!form.full_name.trim()) {
      toast.error("Full name is required.");
      return;
    }
    if (!job.contact_id) {
      toast.error("No contact linked to this job.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("contacts")
      .update({
        full_name: form.full_name.trim(),
        phone: normalizePhoneToE164(form.phone) ?? (form.phone.trim() || null),
        email: form.email.trim() || null,
        role: form.role,
      })
      .eq("id", job.contact_id);

    if (error) {
      toast.error("Failed to update contact.");
    } else {
      toast.success("Contact updated.");
      onOpenChange(false);
      onSaved();
    }
    setSaving(false);
  }

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  if (!job.contact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Full Name *</label>
            <Input value={form.full_name} onChange={(e) => update("full_name", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Phone</label>
            <Input type="tel" value={form.phone} onChange={(e) => update("phone", formatPhoneNumber(e.target.value))} placeholder="(512) 555-0101" />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Email</label>
            <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="contact@email.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Role</label>
            <select
              value={form.role}
              onChange={(e) => update("role", e.target.value)}
              className="w-full h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20"
            >
              <option value="homeowner">Homeowner</option>
              <option value="tenant">Tenant</option>
              <option value="property_manager">Property Manager</option>
              <option value="adjuster">Adjuster</option>
              <option value="insurance">Insurance</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="gradient" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Edit Insurance Dialog ── */

function EditInsuranceDialog({
  open,
  onOpenChange,
  job,
  jobId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  jobId: string;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  // The linked insurance company is chosen with InsuranceCompanyPicker
  // rather than typed. `insuranceTouched` records whether the picker was
  // actually used this session — when it was not, the save leaves a
  // legacy job's free-text insurance_company name untouched (#193).
  const [insuranceContact, setInsuranceContact] = useState<Contact | null>(null);
  const [insuranceTouched, setInsuranceTouched] = useState(false);
  const [form, setForm] = useState({
    claim_number: "",
    policy_number: "",
    date_of_loss: "",
    deductible: "",
    hoa_name: "",
    hoa_contact_name: "",
    hoa_contact_phone: "",
    hoa_contact_email: "",
  });

  useEffect(() => {
    if (open) {
      setInsuranceContact(job.insurance_contact ?? null);
      setInsuranceTouched(false);
      setForm({
        claim_number: job.claim_number || "",
        policy_number: job.policy_number || "",
        date_of_loss: job.date_of_loss || "",
        deductible: job.deductible != null ? String(job.deductible) : "",
        hoa_name: job.hoa_name || "",
        hoa_contact_name: job.hoa_contact_name || "",
        hoa_contact_phone: formatPhoneNumber(job.hoa_contact_phone || ""),
        hoa_contact_email: job.hoa_contact_email || "",
      });
    }
  }, [open, job]);

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();
    const jobUpdate: Record<string, unknown> = {
      claim_number: form.claim_number.trim() || null,
      policy_number: form.policy_number.trim() || null,
      date_of_loss: form.date_of_loss || null,
      deductible: form.deductible ? Number(form.deductible) : null,
      hoa_name: form.hoa_name.trim() || null,
      hoa_contact_name: form.hoa_contact_name.trim() || null,
      hoa_contact_phone: normalizePhoneToE164(form.hoa_contact_phone) ?? (form.hoa_contact_phone.trim() || null),
      hoa_contact_email: form.hoa_contact_email.trim() || null,
    };
    // Only rewrite the insurance link when the picker was actually used.
    // A legacy job carries a free-text insurance_company name and no
    // insurance_contact_id; saving unrelated fields must not erase it.
    // When the picker is used, insurance_company is snapshotted from the
    // selected contact's name so existing free-text readers stay valid.
    if (insuranceTouched) {
      jobUpdate.insurance_contact_id = insuranceContact?.id ?? null;
      jobUpdate.insurance_company = insuranceContact?.full_name ?? null;
    }
    const { error } = await supabase
      .from("jobs")
      .update(jobUpdate)
      .eq("id", jobId);

    if (error) {
      toast.error("Failed to update insurance info.");
    } else {
      toast.success("Insurance info updated.");
      onOpenChange(false);
      onSaved();
    }
    setSaving(false);
  }

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Insurance &amp; HOA</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Insurance Company</label>
            {job.insurance_company && !job.insurance_contact_id && !insuranceTouched && (
              <p className="text-xs text-muted-foreground/70 mb-1.5">
                Currently: {job.insurance_company} &middot; not linked to a contact
              </p>
            )}
            <InsuranceCompanyPicker
              value={insuranceContact}
              onChange={(c) => {
                setInsuranceContact(c);
                setInsuranceTouched(true);
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Claim #</label>
              <Input value={form.claim_number} onChange={(e) => update("claim_number", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Policy #</label>
              <Input value={form.policy_number} onChange={(e) => update("policy_number", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Date of Loss</label>
              <Input type="date" value={form.date_of_loss} onChange={(e) => update("date_of_loss", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Deductible</label>
              <Input type="number" value={form.deductible} onChange={(e) => update("deductible", e.target.value)} placeholder="e.g. 1000" />
            </div>
          </div>
          <div className="border-t border-border/50 pt-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">HOA</p>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">HOA Name</label>
              <Input value={form.hoa_name} onChange={(e) => update("hoa_name", e.target.value)} placeholder="e.g. Lakewood HOA" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Contact Name</label>
                <Input value={form.hoa_contact_name} onChange={(e) => update("hoa_contact_name", e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Contact Phone</label>
                <Input type="tel" value={form.hoa_contact_phone} onChange={(e) => update("hoa_contact_phone", formatPhoneNumber(e.target.value))} />
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-sm font-medium text-muted-foreground mb-1">Contact Email</label>
              <Input type="email" value={form.hoa_contact_email} onChange={(e) => update("hoa_contact_email", e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="gradient" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Add Adjuster Dialog ── */

function AddAdjusterDialog({
  open,
  onOpenChange,
  jobId,
  existingAdjusterIds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  existingAdjusterIds: string[];
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<"search" | "create">("search");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState({
    full_name: "",
    title: "",
    company: "",
    phone: "",
    email: "",
  });

  useEffect(() => {
    if (!open) {
      setMode("search");
      setSearch("");
      setResults([]);
      setCreateForm({ full_name: "", title: "", company: "", phone: "", email: "" });
    }
  }, [open]);

  useEffect(() => {
    if (mode !== "search" || !search.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      const supabase = createClient();
      const term = escapeOrFilterValue(`%${search.trim()}%`);
      const { data } = await supabase
        .from("contacts")
        .select("*")
        .eq("role", "adjuster")
        .or(`full_name.ilike.${term},company.ilike.${term},email.ilike.${term}`)
        .limit(10);
      if (data) {
        setResults(data.filter((c: Contact) => !existingAdjusterIds.includes(c.id)));
      }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, mode, existingAdjusterIds]);

  async function linkAdjuster(contactId: string) {
    setSaving(true);
    const supabase = createClient();
    const isPrimary = existingAdjusterIds.length === 0;
    const { error } = await supabase.from("job_adjusters").insert({
      organization_id: await getActiveOrganizationId(supabase),
      job_id: jobId,
      contact_id: contactId,
      is_primary: isPrimary,
    });
    if (error) {
      toast.error("Failed to add adjuster.");
    } else {
      toast.success("Adjuster added.");
      onOpenChange(false);
      onSaved();
    }
    setSaving(false);
  }

  async function handleCreate() {
    if (!createForm.full_name.trim()) {
      toast.error("Full name is required.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const orgId = await getActiveOrganizationId(supabase);
    const { data: newContact, error: contactError } = await supabase
      .from("contacts")
      .insert({
        organization_id: orgId,
        full_name: createForm.full_name.trim(),
        title: createForm.title.trim() || null,
        company: createForm.company.trim() || null,
        phone: normalizePhoneToE164(createForm.phone) ?? (createForm.phone.trim() || null),
        email: createForm.email.trim() || null,
        role: "adjuster",
      })
      .select()
      .single();

    if (contactError || !newContact) {
      toast.error("Failed to create adjuster contact.");
      setSaving(false);
      return;
    }

    const isPrimary = existingAdjusterIds.length === 0;
    const { error: linkError } = await supabase.from("job_adjusters").insert({
      organization_id: orgId,
      job_id: jobId,
      contact_id: newContact.id,
      is_primary: isPrimary,
    });

    if (linkError) {
      toast.error("Contact created but failed to link to job.");
    } else {
      toast.success("Adjuster created and added.");
      onOpenChange(false);
      onSaved();
    }
    setSaving(false);
  }

  function updateCreate(field: string, value: string) {
    setCreateForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Adjuster</DialogTitle>
        </DialogHeader>

        {/* Mode tabs */}
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          <button
            className={cn("flex-1 text-sm py-1.5 rounded-md transition-colors", mode === "search" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setMode("search")}
          >
            Search Existing
          </button>
          <button
            className={cn("flex-1 text-sm py-1.5 rounded-md transition-colors", mode === "create" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setMode("create")}
          >
            Create New
          </button>
        </div>

        {mode === "search" ? (
          <div className="space-y-3">
            <Input
              placeholder="Search by name, company, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {searching && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!searching && results.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {results.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors"
                    onClick={() => linkAdjuster(c.id)}
                    disabled={saving}
                  >
                    <p className="text-sm font-medium text-foreground">{c.full_name}</p>
                    <p className="text-xs text-muted-foreground">{[c.title, c.company].filter(Boolean).join(" \u00b7 ")}</p>
                    <p className="text-xs text-muted-foreground">{[formatPhoneNumber(c.phone || ""), c.email].filter(Boolean).join(" \u00b7 ")}</p>
                  </button>
                ))}
              </div>
            )}
            {!searching && search.trim() && results.length === 0 && (
              <p className="text-sm text-muted-foreground/60 text-center py-4">No matching adjusters found</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Full Name *</label>
              <Input value={createForm.full_name} onChange={(e) => updateCreate("full_name", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Title</label>
                <Input value={createForm.title} onChange={(e) => updateCreate("title", e.target.value)} placeholder="e.g. Field Adjuster" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Company</label>
                <Input value={createForm.company} onChange={(e) => updateCreate("company", e.target.value)} placeholder="e.g. State Farm" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Phone</label>
              <Input type="tel" value={createForm.phone} onChange={(e) => updateCreate("phone", formatPhoneNumber(e.target.value))} placeholder="(512) 555-0101" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Email</label>
              <Input type="email" value={createForm.email} onChange={(e) => updateCreate("email", e.target.value)} placeholder="adjuster@company.com" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="gradient" onClick={handleCreate} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create & Add"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Payer Type Badge ── */
function PayerTypeBadge({ value }: { value: "insurance" | "homeowner" | "mixed" }) {
  const styles = {
    insurance: { bg: "rgba(139, 92, 246, 0.15)", color: "#C4B5FD", border: "rgba(139, 92, 246, 0.35)", label: "Insurance" },
    homeowner: { bg: "rgba(59, 130, 246, 0.15)", color: "#93C5FD", border: "rgba(59, 130, 246, 0.35)", label: "Homeowner" },
    mixed: { bg: "rgba(250, 199, 117, 0.15)", color: "#FAC775", border: "rgba(250, 199, 117, 0.35)", label: "Mixed" },
  }[value];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: styles.bg, color: styles.color, border: `1px solid ${styles.border}` }}
    >
      {styles.label}
    </span>
  );
}
