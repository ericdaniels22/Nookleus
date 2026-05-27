"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useConfig } from "@/lib/config-context";
import { formatPhoneNumber, isValidUSPhone, normalizePhoneToE164 } from "@/lib/phone";
import { isValidPastDate } from "@/lib/date-field";
import { DateField } from "@/components/date-field";
import InsuranceCompanyPicker from "@/components/insurance-company-picker";
import ReferrerPicker, {
  type ReferrerPickerPartner,
} from "@/components/referral-partners/referrer-picker";
import type { Contact, FormConfig, FormField } from "@/lib/types";

export default function IntakeForm({ testMode = false }: { testMode?: boolean } = {}) {
  const router = useRouter();
  const { damageTypes } = useConfig();
  const [submitting, setSubmitting] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [formConfig, setFormConfig] = useState<FormConfig | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  // The field mapped to job.insurance_company is chosen with the
  // InsuranceCompanyPicker rather than typed. This holds the picked
  // contact so the submit can write its id; the company-name snapshot
  // is mirrored into `values` so the existing required-field check and
  // the insurance_company write keep working unchanged (#195).
  const [insuranceContact, setInsuranceContact] = useState<Contact | null>(null);
  // Slice D (#302): when the built-in `referrer` field is enabled in the
  // config, the renderer surfaces it as a `<ReferrerPicker>` and writes the
  // picked partner's id to `jobs.referral_partner_id` on submit — bypassing
  // the generic `job_custom_fields` write path.
  const [referralPartnerId, setReferralPartnerId] = useState<string | null>(null);
  const [referralPartners, setReferralPartners] = useState<ReferrerPickerPartner[]>([]);

  // Load form config
  useEffect(() => {
    fetch("/api/settings/intake-form")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.config?.sections) {
          setFormConfig(data.config);
          // Set default values
          const defaults: Record<string, string> = {};
          for (const section of data.config.sections) {
            for (const field of section.fields) {
              if (field.default_value) defaults[field.id] = field.default_value;
            }
          }
          setValues(defaults);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));
  }, []);

  // Fetch the picker's source-of-truth partner list (Active + yellow Targets,
  // not trashed) once we know the form has a referrer field. The picker uses
  // `eligibilityFor()` to slot rows into pickable / promote-then-pick / hidden
  // groups — passing the unfiltered live list is what lets yellow Targets
  // appear under the `+ Promote and attach` affordance.
  const hasReferrerField = !!formConfig?.sections.some((s) =>
    s.fields.some((f) => f.maps_to === "job.referral_partner_id"),
  );
  useEffect(() => {
    if (!hasReferrerField) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("referral_partners")
        .select("id, company_name, status, deleted_at")
        .is("deleted_at", null)
        .order("company_name", { ascending: true });
      if (!cancelled && data) {
        setReferralPartners(data as ReferrerPickerPartner[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasReferrerField]);

  async function handlePromoteAndPick(partnerId: string) {
    // Mirrors the Edit Job Info dialog flow (#298): flip the yellow Target
    // to Active via PATCH so the server-side eligibility check has something
    // to accept, then attach to the Job. The actual FK write happens at
    // submit time — here we only flip the status and optimistically reflect
    // it in local state so the picker re-renders the row as pickable.
    const res = await fetch(`/api/referral-partners/${partnerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "green" }),
    });
    if (!res.ok) {
      toast.error("Couldn't promote the Target — try again.");
      return;
    }
    setReferralPartners((prev) =>
      prev.map((p) => (p.id === partnerId ? { ...p, status: "green" } : p)),
    );
    setReferralPartnerId(partnerId);
  }

  function setValue(fieldId: string, value: string) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  // The insurance picker yields a contact (or null) rather than text.
  // Mirror its name into `values` as the company-name snapshot so the
  // required check and insurance_company write see it like any field.
  function setInsurance(fieldId: string, contact: Contact | null) {
    setInsuranceContact(contact);
    setValue(fieldId, contact?.full_name ?? "");
  }

  function getVal(id: string): string {
    return values[id] || "";
  }

  function valueByMapsTo(target: string): string {
    if (!formConfig) return "";
    for (const section of formConfig.sections) {
      for (const field of section.fields) {
        if (field.maps_to === target) return getVal(field.id);
      }
    }
    return "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (formConfig) {
      for (const section of formConfig.sections) {
        if (section.visible === false) continue;
        for (const field of section.fields) {
          if (field.visible === false) continue;
          if (field.show_when) {
            const [depId, depVal] = field.show_when.split("=");
            if (getVal(depId) !== depVal) continue;
          }
          if (field.required && !getVal(field.id)) {
            toast.error(`Please fill in: ${field.label}`);
            return;
          }
          if (
            field.type === "phone" &&
            getVal(field.id).trim() &&
            !isValidUSPhone(getVal(field.id))
          ) {
            toast.error(`${field.label} must be a valid 10-digit US phone number.`);
            return;
          }
          if (
            field.type === "date" &&
            getVal(field.id).trim() &&
            !isValidPastDate(getVal(field.id))
          ) {
            toast.error(`${field.label} must be a valid date that is not in the future.`);
            return;
          }
        }
      }
    }

    if (testMode) {
      toast.info("Test submission — not saved");
      return;
    }

    const fullName = valueByMapsTo("contact.full_name");
    const damageType = valueByMapsTo("job.damage_type");
    const propertyAddress = valueByMapsTo("job.property_address");

    if (!fullName || !damageType || !propertyAddress) {
      toast.error("Please fill in required fields: Full Name, Damage Type, and Property Address.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const orgId = await getActiveOrganizationId(supabase);
    if (!orgId) {
      toast.error("No active organization — please sign in again.");
      setSubmitting(false);
      return;
    }

    try {
      const { data: contact, error: contactErr } = await supabase
        .from("contacts")
        .insert({
          organization_id: orgId,
          full_name: fullName,
          phone: normalizePhoneToE164(valueByMapsTo("contact.phone")),
          email: valueByMapsTo("contact.email") || null,
          role: valueByMapsTo("contact.role") || "homeowner",
          notes: valueByMapsTo("contact.notes") || null,
        })
        .select()
        .single();

      if (contactErr) throw contactErr;

      let adjusterContactId: string | null = null;
      const adjusterFullName = valueByMapsTo("adjuster.full_name") || getVal("adjuster_name");
      if (adjusterFullName) {
        const { data: adjuster, error: adjErr } = await supabase
          .from("contacts")
          .insert({
            organization_id: orgId,
            full_name: adjusterFullName.trim(),
            phone: normalizePhoneToE164(valueByMapsTo("adjuster.phone") || getVal("adjuster_phone")),
            role: "adjuster",
            title: valueByMapsTo("adjuster.title") || getVal("adjuster_title") || null,
          })
          .select()
          .single();

        if (adjErr) throw adjErr;
        adjusterContactId = adjuster.id;
      }

      const propertySqft = valueByMapsTo("job.property_sqft");
      const propertyStories = valueByMapsTo("job.property_stories");
      const damageSource = valueByMapsTo("job.damage_source");

      const jobPayload: Record<string, unknown> = {
        organization_id: orgId,
        contact_id: contact.id,
        damage_type: damageType,
        damage_source: damageSource || null,
        property_address: propertyAddress,
        property_type: valueByMapsTo("job.property_type") || null,
        property_sqft: propertySqft ? parseInt(propertySqft) : null,
        property_stories: propertyStories ? parseInt(propertyStories) : null,
        affected_areas: valueByMapsTo("job.affected_areas") || null,
        urgency: valueByMapsTo("job.urgency") || "scheduled",
        insurance_company: valueByMapsTo("job.insurance_company") || null,
        insurance_contact_id: insuranceContact?.id ?? null,
        claim_number: valueByMapsTo("job.claim_number") || null,
        access_notes: valueByMapsTo("job.access_notes") || null,
      };
      // Only attach the FK when the referrer field is enabled in this org's
      // config — preserves today's payload shape (no extra key) for orgs
      // that haven't opted into the toggle. ADR-0002 eligibility still holds
      // because the picker only exposes pickable partners and the server-
      // side check runs whenever the FK is written.
      if (hasReferrerField) {
        jobPayload.referral_partner_id = referralPartnerId;
      }

      const { data: job, error: jobErr } = await supabase
        .from("jobs")
        .insert(jobPayload)
        .select()
        .single();

      if (jobErr) throw jobErr;

      if (adjusterContactId && job) {
        const { error: adjLinkErr } = await supabase
          .from("job_adjusters")
          .insert({
            organization_id: orgId,
            job_id: job.id,
            contact_id: adjusterContactId,
            is_primary: true,
          });
        if (adjLinkErr) throw adjLinkErr;
      }

      if (formConfig) {
        const customFields: { organization_id: string; job_id: string; field_key: string; field_value: string }[] = [];
        for (const section of formConfig.sections) {
          for (const field of section.fields) {
            if (!field.maps_to && !field.is_default && getVal(field.id)) {
              customFields.push({
                organization_id: orgId,
                job_id: job.id,
                field_key: field.id,
                field_value: getVal(field.id),
              });
            }
          }
        }
        if (customFields.length > 0) {
          await supabase.from("job_custom_fields").insert(customFields);
        }
      }

      const customerNotes = valueByMapsTo("contact.notes");
      const whenHappened = getVal("when_happened");
      const activityParts = [];
      if (whenHappened) activityParts.push(`When it happened: ${whenHappened}`);
      if (damageSource) activityParts.push(`Source: ${damageSource}`);
      if (customerNotes) activityParts.push(`Notes: ${customerNotes}`);

      if (activityParts.length > 0) {
        await supabase.from("job_activities").insert({
          organization_id: orgId,
          job_id: job.id,
          activity_type: "note",
          title: "Intake notes",
          description: activityParts.join("\n"),
          author: "Eric",
        });
      }

      toast.success(`Job ${job.job_number} created successfully!`);
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      console.error(err);
      // The eligibility trigger from migration-302 raises an exception whose
      // message begins with "RP-INELIGIBLE:" when a non-Active / trashed /
      // cross-Organization Referral Partner is attached. Surface a clear
      // toast so the office user knows to re-pick rather than retry blind.
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: unknown }).message ?? "")
          : "";
      if (message.includes("RP-INELIGIBLE")) {
        toast.error("That Referral Partner can't be attached. Please pick another.");
      } else {
        toast.error("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingConfig) {
    return <div className="text-center py-12 text-muted-foreground">Loading form...</div>;
  }

  if (!formConfig || formConfig.sections.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No form configuration found.</p>
        <a href="/settings/intake-form" className="text-sm text-[var(--brand-primary)] hover:underline mt-1 inline-block">
          Set up the intake form
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {formConfig.sections
        .filter((s) => s.visible !== false)
        .map((section, si) => (
          <SectionCard key={section.id} number={si + 1} title={section.title}>
            <div className="space-y-4">
              {section.fields
                .filter((f) => f.visible !== false)
                .filter((f) => {
                  // Check show_when condition
                  if (f.show_when) {
                    const [depId, depVal] = f.show_when.split("=");
                    return getVal(depId) === depVal;
                  }
                  return true;
                })
                .map((field) => (
                  <DynamicField
                    key={field.id}
                    field={field}
                    value={getVal(field.id)}
                    onChange={(v) => setValue(field.id, v)}
                    damageTypes={damageTypes}
                    insuranceContact={insuranceContact}
                    onInsuranceChange={(c) => setInsurance(field.id, c)}
                    referralPartners={referralPartners}
                    referralPartnerId={referralPartnerId}
                    onReferralPartnerChange={setReferralPartnerId}
                    onPromoteAndPickReferralPartner={handlePromoteAndPick}
                  />
                ))}
            </div>
          </SectionCard>
        ))}

      {/* Submit */}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={submitting}
          className="px-6 py-2.5 bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating Job...
            </>
          ) : (
            "Create Job"
          )}
        </Button>
      </div>
    </form>
  );
}

// ── Dynamic field renderer ──────────────────────────

function DynamicField({
  field,
  value,
  onChange,
  damageTypes,
  insuranceContact,
  onInsuranceChange,
  referralPartners,
  referralPartnerId,
  onReferralPartnerChange,
  onPromoteAndPickReferralPartner,
}: {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
  damageTypes: { name: string; display_label: string; bg_color: string; text_color: string }[];
  insuranceContact: Contact | null;
  onInsuranceChange: (c: Contact | null) => void;
  referralPartners: ReferrerPickerPartner[];
  referralPartnerId: string | null;
  onReferralPartnerChange: (id: string | null) => void;
  onPromoteAndPickReferralPartner: (id: string) => void;
}) {
  // Get options — from damage_types config or field.options
  let options = field.options || [];
  if (field.options_source === "damage_types") {
    options = damageTypes.map((dt) => ({
      value: dt.name,
      label: dt.display_label,
      color: `bg-[${dt.bg_color}] text-[${dt.text_color}] border-[${dt.text_color}]/20`,
    }));
  }

  // Quiet-swap: the field mapped to job.insurance_company renders the
  // shared InsuranceCompanyPicker (search + inline create) in place of
  // its configured plain input — same idea as the damage_types option
  // source above, no new field type, no form-config change (#195).
  const isInsuranceCompany = field.maps_to === "job.insurance_company";
  // Slice D (#302): the built-in `referrer` field is special — its value is
  // a Referral Partner id, not free text, and it persists to the FK column
  // on jobs rather than to `job_custom_fields`. The renderer surfaces the
  // shared `<ReferrerPicker>` (same component the Edit Job Info dialog uses)
  // so the eligibility rule from ADR-0002 stays the single source of truth.
  const isReferrer = field.maps_to === "job.referral_partner_id";

  return (
    <div>
      {field.type !== "checkbox" && (
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">
          {field.label}
          {field.required && <span className="text-destructive ml-0.5">*</span>}
        </label>
      )}

      {field.help_text && (
        <p className="text-xs text-muted-foreground/70 mb-1.5">{field.help_text}</p>
      )}

      {isInsuranceCompany && (
        <InsuranceCompanyPicker
          value={insuranceContact}
          onChange={onInsuranceChange}
        />
      )}

      {isReferrer && (
        <ReferrerPicker
          partners={referralPartners}
          value={referralPartnerId}
          onChange={onReferralPartnerChange}
          onPromoteAndPick={onPromoteAndPickReferralPartner}
        />
      )}

      {!isInsuranceCompany && !isReferrer &&
        (field.type === "text" || field.type === "phone" || field.type === "email") && (
        <Input
          type={field.type === "phone" ? "tel" : field.type === "email" ? "email" : "text"}
          value={value}
          onChange={(e) =>
            onChange(field.type === "phone" ? formatPhoneNumber(e.target.value) : e.target.value)
          }
          placeholder={field.placeholder}
        />
      )}

      {field.type === "number" && (
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}

      {field.type === "date" && (
        <DateField
          value={value}
          onChange={onChange}
          placeholder={field.placeholder}
        />
      )}

      {field.type === "textarea" && (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
        />
      )}

      {field.type === "select" && (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20"
        >
          <option value="">Select...</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {field.type === "pill" && (
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => {
            const isSelected = value === opt.value;
            const hasInlineColor = !!(opt.bg_color || opt.text_color);
            const inlineSelectedStyle = isSelected && hasInlineColor
              ? { backgroundColor: opt.bg_color, color: opt.text_color, borderColor: "transparent" }
              : undefined;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                style={inlineSelectedStyle}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium border transition-all",
                  isSelected
                    ? hasInlineColor
                      ? "shadow-sm"
                      : opt.color || "bg-[image:var(--gradient-primary)] text-white border-transparent shadow-sm"
                    : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {field.type === "checkbox" && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
            className="w-4 h-4 rounded accent-[var(--brand-primary)]"
          />
          <span className="text-sm text-foreground">{field.label}</span>
        </label>
      )}
    </div>
  );
}

// ── Section card wrapper ────────────────────────────

function SectionCard({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 sm:p-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-secondary text-white text-xs font-bold">
          {number}
        </span>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}
