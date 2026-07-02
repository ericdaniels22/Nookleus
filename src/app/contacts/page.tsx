"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Contact } from "@/lib/types";
import { formatPhoneNumber, normalizePhoneToE164, phoneMatchesQuery } from "@/lib/phone";
import { ClickToText } from "@/components/phone/click-to-text";
import { ClickToCall } from "@/components/phone/click-to-call";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import PageHeader from "@/components/page-header";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Users,
  Plus,
  Search,
  Phone,
  Mail,
  Building2,
  Pencil,
  Trash2,
  Briefcase,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import Link from "next/link";
import { format } from "date-fns";

const roleOptions = [
  { value: "homeowner", label: "Homeowner" },
  { value: "tenant", label: "Tenant" },
  { value: "property_manager", label: "Prop Manager" },
  { value: "adjuster", label: "Adjuster" },
  { value: "insurance", label: "Insurance" },
];

// Role is metadata, not a status/urgency/damage vocabulary, so per design-
// system §1 + §5 it carries no decorative color — the label text is the
// distinction (issue #255: pick out a Referral Partner "at a glance" from the
// wording, not a hue). Rendered as a neutral outline badge; the former light-
// mode hex map was dropped in the design-v2 pass (#921).
const roleLabels: Record<string, string> = {
  homeowner: "Homeowner",
  tenant: "Tenant",
  property_manager: "Prop Manager",
  adjuster: "Adjuster",
  insurance: "Insurance",
  referral_contact: "Referral Contact",
};

type ContactWithJobs = Contact & {
  job_count?: number;
};

const emptyForm = {
  full_name: "",
  phone: "",
  email: "",
  role: "homeowner" as Contact["role"],
  company: "",
  notes: "",
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<ContactWithJobs[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchContacts = useCallback(async () => {
    const supabase = createClient();

    // Fetch contacts with job count
    const orgId = await getActiveOrganizationId(supabase);
    const { data: contactsData } = await supabase
      .from("contacts")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (!contactsData) {
      setContacts([]);
      setLoading(false);
      return;
    }

    // Get job counts per contact
    const { data: jobCounts } = await supabase
      .from("jobs")
      .select("contact_id")
      .eq("organization_id", orgId);

    const countMap: Record<string, number> = {};
    if (jobCounts) {
      for (const j of jobCounts) {
        countMap[j.contact_id] = (countMap[j.contact_id] || 0) + 1;
      }
    }

    setContacts(
      contactsData.map((c) => ({
        ...c,
        job_count: countMap[c.id] || 0,
      })) as ContactWithJobs[]
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Filtered contacts
  const filtered = contacts.filter((c) => {
    if (roleFilter !== "all" && c.role !== roleFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const fullName = c.full_name.toLowerCase();
      return (
        fullName.includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        phoneMatchesQuery(c.phone, search) ||
        c.company?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Stats
  const totalContacts = contacts.length;
  const adjustersCount = contacts.filter((c) => c.role === "adjuster").length;
  const homeownersCount = contacts.filter((c) => c.role === "homeowner").length;

  function openAddDialog() {
    setEditingContact(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditDialog(contact: Contact) {
    setEditingContact(contact);
    setForm({
      full_name: contact.full_name,
      phone: formatPhoneNumber(contact.phone || ""),
      email: contact.email || "",
      role: contact.role,
      company: contact.company || "",
      notes: contact.notes || "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.full_name.trim()) {
      toast.error("Full name is required");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const payload = {
      full_name: form.full_name.trim(),
      phone: normalizePhoneToE164(form.phone) ?? (form.phone.trim() || null),
      email: form.email.trim() || null,
      role: form.role,
      company: form.company.trim() || null,
      notes: form.notes.trim() || null,
    };

    if (editingContact) {
      const { error } = await supabase
        .from("contacts")
        .update(payload)
        .eq("id", editingContact.id)
        .eq("organization_id", await getActiveOrganizationId(supabase));

      if (error) {
        toast.error("Failed to update contact");
        console.error(error);
      } else {
        toast.success("Contact updated");
        setDialogOpen(false);
        fetchContacts();
      }
    } else {
      const { error } = await supabase
        .from("contacts")
        .insert({ ...payload, organization_id: await getActiveOrganizationId(supabase) });

      if (error) {
        toast.error("Failed to create contact");
        console.error(error);
      } else {
        toast.success("Contact created");
        setDialogOpen(false);
        fetchContacts();
      }
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("contacts")
      .delete()
      .eq("id", deleteTarget.id)
      .eq("organization_id", await getActiveOrganizationId(supabase));

    if (error) {
      toast.error(
        error.message.includes("foreign key")
          ? "Cannot delete — this contact is linked to jobs"
          : "Failed to delete contact"
      );
    } else {
      toast.success("Contact deleted");
      fetchContacts();
    }
    setDeleteTarget(null);
    setDeleting(false);
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Contacts"
        subtitle={
          <>
            {totalContacts} contact{totalContacts !== 1 ? "s" : ""} &middot;{" "}
            {homeownersCount} homeowner{homeownersCount !== 1 ? "s" : ""} &middot;{" "}
            {adjustersCount} adjuster{adjustersCount !== 1 ? "s" : ""}
          </>
        }
        actions={
          <button
            onClick={openAddDialog}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus size={16} />
            Add Contact
          </button>
        }
      />

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone, or company..."
            className="pl-9"
          />
        </div>
      </div>

      {/* Role filter pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => setRoleFilter("all")}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            roleFilter === "all"
              ? "border-transparent bg-accent-tint text-accent-text"
              : "border-border bg-card text-muted-foreground hover:bg-muted"
          )}
        >
          All
        </button>
        {roleOptions.map((r) => (
          <button
            key={r.value}
            onClick={() =>
              setRoleFilter(roleFilter === r.value ? "all" : r.value)
            }
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              roleFilter === r.value
                ? "border-transparent bg-accent-tint text-accent-text"
                : "border-border bg-card text-muted-foreground hover:bg-muted"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Contact list — a single card of hairline-separated rows (§5); each
          row collapses gracefully to a stacked card on phone width (§7.1). */}
      {loading ? (
        <div className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-card">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={Users}
            title={
              search || roleFilter !== "all"
                ? "No contacts match your filters"
                : "No contacts yet"
            }
            description={
              search || roleFilter !== "all"
                ? "Try a different name, role, or search term."
                : "Add your first contact to start tracking homeowners, adjusters, and partners."
            }
            action={
              !search && roleFilter === "all" ? (
                <button
                  onClick={openAddDialog}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Plus size={16} />
                  Add Contact
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-card">
          {filtered.map((contact) => (
            <div
              key={contact.id}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted"
            >
              {/* Left: avatar + name + details */}
              <Avatar name={contact.full_name} className="mt-0.5" />
              <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-foreground truncate">
                      {contact.full_name}
                    </h3>
                    <Badge variant="outline" className="shrink-0">
                      {roleLabels[contact.role] || contact.role}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {contact.phone && (
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex items-center gap-1">
                          <Phone size={12} className="text-muted-foreground/60" />
                          {formatPhoneNumber(contact.phone)}
                        </span>
                        <ClickToText
                          e164={normalizePhoneToE164(contact.phone) ?? contact.phone}
                          className="text-[11px] text-accent-text hover:underline"
                          label="Text"
                        />
                        {/* Slice 10 (#314) — Contact-card click-to-call.
                            Untagged (re-tag after the fact); no A2P gate. */}
                        <ClickToCall
                          e164={normalizePhoneToE164(contact.phone) ?? contact.phone}
                          sourceContext={{ kind: "contact" }}
                          className="inline-flex items-center gap-1 text-[11px] text-accent-text hover:underline disabled:opacity-50"
                        />
                      </span>
                    )}
                    {contact.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail size={12} className="text-muted-foreground/60" />
                        {contact.email}
                      </span>
                    )}
                    {contact.company && (
                      <span className="inline-flex items-center gap-1">
                        <Building2 size={12} className="text-muted-foreground/60" />
                        {contact.company}
                      </span>
                    )}
                    {(contact.job_count ?? 0) > 0 && (
                      <Link
                        href={`/jobs?contact=${contact.id}`}
                        className="inline-flex items-center gap-1 text-accent-text hover:underline"
                      >
                        <Briefcase size={12} />
                        {contact.job_count} job{contact.job_count !== 1 ? "s" : ""}
                      </Link>
                    )}
                  </div>
                {contact.notes && (
                  <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">
                    {contact.notes}
                  </p>
                )}
              </div>

              {/* Right: actions — always visible (§7.2: no hover-only
                  affordances), 44px touch target on phone, 36px at sm+. */}
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  onClick={() => openEditDialog(contact)}
                  className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:size-9"
                  title="Edit"
                  aria-label={`Edit ${contact.full_name}`}
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => setDeleteTarget(contact)}
                  className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive sm:size-9"
                  title="Delete"
                  aria-label={`Delete ${contact.full_name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingContact ? "Edit Contact" : "New Contact"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Full Name *
              </label>
              <Input
                value={form.full_name}
                onChange={(e) =>
                  setForm({ ...form, full_name: e.target.value })
                }
                placeholder="Full name"
              />
            </div>

            {/* Role pills */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Role
              </label>
              <div className="flex flex-wrap gap-2">
                {roleOptions.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() =>
                      setForm({ ...form, role: r.value as Contact["role"] })
                    }
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      form.role === r.value
                        ? "border-transparent bg-accent-tint text-accent-text"
                        : "border-border bg-card text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Phone + Email */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Phone
                </label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: formatPhoneNumber(e.target.value) })}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Email
                </label>
                <Input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="email@example.com"
                  type="email"
                />
              </div>
            </div>

            {/* Company */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Company
              </label>
              <Input
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                placeholder="Company name"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Notes
              </label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional notes about this contact..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose className="min-h-11 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted">
              Cancel
            </DialogClose>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {editingContact ? "Save Changes" : "Create Contact"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Contact</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete{" "}
            <span className="font-medium text-foreground">
              {deleteTarget?.full_name}
            </span>
            ? This cannot be undone.
          </p>
          {(deleteTarget as ContactWithJobs)?.job_count ? (
            <p className="rounded-lg bg-warning-tint px-3 py-2 text-xs text-warning">
              This contact is linked to{" "}
              {(deleteTarget as ContactWithJobs).job_count} job(s) and cannot be
              deleted until those jobs are reassigned.
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose className="min-h-11 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted">
              Cancel
            </DialogClose>
            <button
              onClick={handleDelete}
              disabled={deleting || !!(deleteTarget as ContactWithJobs)?.job_count}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
            >
              {deleting && <Loader2 size={14} className="animate-spin" />}
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
