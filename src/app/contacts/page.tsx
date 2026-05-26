"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Contact } from "@/lib/types";
import { formatPhoneNumber, normalizePhoneToE164, phoneMatchesQuery } from "@/lib/phone";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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

const roleColors: Record<string, string> = {
  homeowner: "bg-[#E6F1FB] text-[#0C447C]",
  tenant: "bg-[#EEEDFE] text-[#3C3489]",
  property_manager: "bg-[#FAEEDA] text-[#633806]",
  adjuster: "bg-[#E1F5EE] text-[#085041]",
  insurance: "bg-[#FFF8E6] text-[#7A5E00]",
  // PRD #249, issue #255: badge for `referral_contact` rows on the
  // Contacts tab — visually consistent with the existing role badges so
  // a user can pick out Referral Partner contacts at a glance.
  referral_contact: "bg-[#FDECEF] text-[#7A1B2B]",
};

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
    <div className="max-w-6xl animate-fade-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground">
            <span className="gradient-text">Contacts</span>
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {totalContacts} contact{totalContacts !== 1 ? "s" : ""} &middot;{" "}
            {homeownersCount} homeowner{homeownersCount !== 1 ? "s" : ""} &middot;{" "}
            {adjustersCount} adjuster{adjustersCount !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={openAddDialog}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all"
        >
          <Plus size={16} />
          Add Contact
        </button>
      </div>

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
            "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
            roleFilter === "all"
              ? "bg-[image:var(--gradient-primary)] text-white border-transparent shadow-sm"
              : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
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
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
              roleFilter === r.value
                ? "bg-[image:var(--gradient-primary)] text-white border-transparent shadow-sm"
                : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Contact list */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground/60">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <Users size={48} className="mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground/60">
            {search || roleFilter !== "all"
              ? "No contacts match your filters"
              : "No contacts yet"}
          </p>
          {!search && roleFilter === "all" && (
            <button
              onClick={openAddDialog}
              className="text-sm text-primary hover:underline font-medium mt-2 inline-block"
            >
              Add your first contact
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((contact) => (
            <div
              key={contact.id}
              className="card-vibrant bg-card rounded-xl border border-border p-4 hover:border-primary/30 transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left: name + details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-foreground truncate">
                      {contact.full_name}
                    </h3>
                    <Badge
                      className={cn(
                        "text-[10px] px-1.5 py-0 rounded-full font-medium shrink-0",
                        roleColors[contact.role] || "bg-gray-100 text-gray-600"
                      )}
                    >
                      {roleLabels[contact.role] || contact.role}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {contact.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone size={12} className="text-muted-foreground/60" />
                        {formatPhoneNumber(contact.phone)}
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
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Briefcase size={12} />
                        {contact.job_count} job{contact.job_count !== 1 ? "s" : ""}
                      </Link>
                    )}
                  </div>
                  {contact.notes && (
                    <p className="text-xs text-muted-foreground/60 mt-1.5 line-clamp-1">
                      {contact.notes}
                    </p>
                  )}
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEditDialog(contact)}
                    className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(contact)}
                    className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-destructive hover:bg-red-50 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
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
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                      form.role === r.value
                        ? roleColors[r.value] + " border-current"
                        : "bg-card text-muted-foreground border-border"
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
            <DialogClose className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:bg-accent transition-colors">
              Cancel
            </DialogClose>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-50 transition-all"
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
            <p className="text-xs text-destructive bg-[#FCEBEB] px-3 py-2 rounded-lg">
              This contact is linked to{" "}
              {(deleteTarget as ContactWithJobs).job_count} job(s) and cannot be
              deleted until those jobs are reassigned.
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:bg-accent transition-colors">
              Cancel
            </DialogClose>
            <button
              onClick={handleDelete}
              disabled={deleting || !!(deleteTarget as ContactWithJobs)?.job_count}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-destructive text-white hover:bg-[#A3171F] disabled:opacity-50 transition-colors"
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
