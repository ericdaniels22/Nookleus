"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Phone as PhoneIcon,
  Plus,
  Trash2,
  Loader2,
  Mic,
  Square,
  Voicemail,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { formatPhoneNumber } from "@/lib/phone";
import {
  startMicWavRecording,
  type MicWavRecording,
} from "@/lib/phone/mic-wav-recorder";

// PRD #304 — Nookleus Phone. Slice 3 (#307) + slice 13 (#317) —
// Settings → Phone tab.
//
// Lists every phone_numbers row the caller can see (RLS-filtered) and
// carries two role-scoped actions, per ADR 0005's access matrix:
//   - Admins provision/release Shared numbers and configure inbound rules.
//   - Any member holding view_phone claims a single Personal number for
//     themselves (self-service), shown in the same list under the Owner
//     column as "You". Untagged Personal lines are owner-only — RLS keeps
//     them out of an admin's list, so the admin affordances never touch them.
//
// Non-admins see the read-only Shared list plus their own Personal line; the
// admin-only management affordances stay hidden.

interface PhoneNumberRow {
  id: string;
  organization_id: string;
  twilio_sid: string;
  e164: string;
  label: string | null;
  kind: "shared" | "personal";
  user_id: string | null;
  inbound_rule: unknown | null;
  // Slice 13 (#317) — the storage path of the number's custom voicemail
  // greeting, or null for the default spoken greeting. The list GET returns it
  // (PHONE_NUMBER_FIELDS); the UI shows set/unset and lets a manager change it.
  voicemail_greeting_url: string | null;
  monthly_cost_cents: number | null;
  is_active: boolean;
  released_at: string | null;
  created_at: string;
}

interface AvailableLocalNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string | null;
  region: string | null;
}

// An org member as returned by GET /api/settings/users. `phone` is the cell
// on file (E.164) or null — the inbound router (decideShared) drops anyone
// without a cell, so only members with one are selectable in the editor.
interface OrgMember {
  id: string;
  full_name: string;
  phone: string | null;
  role: string;
}

type InboundKind = "ring-all" | "round-robin" | "forward" | "voicemail";

// The four routable shapes decideShared understands (ADR 0006). The editor
// builds one of these and PATCHes it; parseInboundRule re-validates server-side.
type InboundRule =
  | { kind: "ring-all"; users: string[] }
  | { kind: "round-robin"; sequence: string[] }
  | { kind: "forward"; forwardUserId: string }
  | { kind: "voicemail" };

const INBOUND_KIND_OPTIONS: { kind: InboundKind; label: string; help: string }[] =
  [
    {
      kind: "ring-all",
      label: "Ring all",
      help: "Ring every selected member's cell at once; first to answer wins.",
    },
    {
      kind: "round-robin",
      label: "Round robin",
      help: "Ring one selected member per call, rotating through the list.",
    },
    {
      kind: "forward",
      label: "Forward",
      help: "Always forward to one member's cell.",
    },
    {
      kind: "voicemail",
      label: "Voicemail",
      help: "Send every caller straight to voicemail.",
    },
  ];

// Map a persisted inbound_rule back to the editor's kind so opening the
// editor pre-selects the number's current rule. A null/unknown rule opens
// on voicemail (decideShared's null fallthrough).
function ruleToKind(rule: unknown): InboundKind {
  if (rule && typeof rule === "object" && "kind" in rule) {
    const k = (rule as { kind: string }).kind;
    if (
      k === "ring-all" ||
      k === "round-robin" ||
      k === "forward" ||
      k === "voicemail"
    ) {
      return k;
    }
  }
  return "voicemail";
}

function formatCents(cents: number | null): string {
  if (cents === null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

// A one-line, human summary of a Shared number's inbound_rule for the table
// cell. Mirrors decideShared: a null (unconfigured) rule falls through to
// voicemail, so it summarizes as "Voicemail" — never the old "ring-all
// default" copy, which was untruthful.
function summarizeInboundRule(rule: unknown): string {
  if (rule && typeof rule === "object" && "kind" in rule) {
    const r = rule as {
      kind: string;
      users?: unknown[];
      sequence?: unknown[];
    };
    if (r.kind === "ring-all" && Array.isArray(r.users)) {
      return `Ring all (${r.users.length})`;
    }
    if (r.kind === "round-robin" && Array.isArray(r.sequence)) {
      return `Round robin (${r.sequence.length})`;
    }
    if (r.kind === "forward") {
      return "Forward";
    }
  }
  return "Voicemail";
}

export function PhoneNumbersTab() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const viewerId = profile?.id ?? null;

  const [rows, setRows] = useState<PhoneNumberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-Shared-Number flow state.
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [areaCode, setAreaCode] = useState("");
  const [searching, setSearching] = useState(false);
  const [available, setAvailable] = useState<AvailableLocalNumber[]>([]);
  const [pickedNumber, setPickedNumber] = useState<AvailableLocalNumber | null>(
    null,
  );
  const [label, setLabel] = useState("");
  const [provisioning, setProvisioning] = useState(false);

  // Claim-Personal-Number flow state (slice 13, #317). A member's own
  // self-service claim: search by area code, pick, claim. The number is
  // always owned by the caller — the route derives the owner from the
  // session, so the dialog never collects an owner. Its own search/pick state
  // keeps it independent of the admin Add-Shared dialog above.
  const [showClaimDialog, setShowClaimDialog] = useState(false);
  const [claimAreaCode, setClaimAreaCode] = useState("");
  const [claimSearching, setClaimSearching] = useState(false);
  const [claimAvailable, setClaimAvailable] = useState<AvailableLocalNumber[]>(
    [],
  );
  const [claimPicked, setClaimPicked] = useState<AvailableLocalNumber | null>(
    null,
  );
  const [claiming, setClaiming] = useState(false);
  // Re-claim revive notice (#317). When a claim revives a number a departed
  // teammate had released, the route answers with `previously_owned_by`; we
  // surface the prior owner here so the new owner knows the line was recycled.
  const [reclaimNotice, setReclaimNotice] = useState<string | null>(null);

  // Release-confirm flow state — the row the admin clicked Release on.
  const [releasing, setReleasing] = useState<PhoneNumberRow | null>(null);
  const [releaseInFlight, setReleaseInFlight] = useState(false);

  // Voicemail-greeting flow state (slice 13, #317). `greetingFor` is the row
  // whose greeting dialog is open. The pending audio is either an uploaded
  // File or a Blob the in-browser recorder produced; `recording` is the live
  // recorder handle while capturing.
  const [greetingFor, setGreetingFor] = useState<PhoneNumberRow | null>(null);
  const [greetingFile, setGreetingFile] = useState<Blob | null>(null);
  const [greetingFileName, setGreetingFileName] = useState<string | null>(null);
  const [recording, setRecording] = useState<MicWavRecording | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [greetingSaving, setGreetingSaving] = useState(false);
  const [greetingRemoving, setGreetingRemoving] = useState(false);

  // Inbound-rule editor state — the Shared row the admin clicked Configure on.
  const [editing, setEditing] = useState<PhoneNumberRow | null>(null);
  const [editKind, setEditKind] = useState<InboundKind>("voicemail");
  // Selected member ids: the ring-all users / round-robin sequence (in click
  // order) and, for forward, the single chosen id at index 0.
  const [editUsers, setEditUsers] = useState<string[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [saveInFlight, setSaveInFlight] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/phone/numbers");
      if (!res.ok) {
        setError("Failed to load phone numbers");
        setRows([]);
        return;
      }
      const data = (await res.json()) as PhoneNumberRow[];
      setRows(data);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Open the inbound-rule editor for a Shared row: pre-select the number's
  // current rule and lazy-load the org roster (only admins reach this, and
  // they have access_settings). Members without a cell are filtered at
  // render — the router would drop them anyway.
  async function openEditor(r: PhoneNumberRow) {
    const rule = r.inbound_rule as
      | { kind?: string; users?: string[]; sequence?: string[]; forwardUserId?: string }
      | null;
    setEditKind(ruleToKind(r.inbound_rule));
    if (rule?.kind === "ring-all" && Array.isArray(rule.users)) {
      setEditUsers(rule.users);
    } else if (rule?.kind === "round-robin" && Array.isArray(rule.sequence)) {
      setEditUsers(rule.sequence);
    } else if (rule?.kind === "forward" && typeof rule.forwardUserId === "string") {
      setEditUsers([rule.forwardUserId]);
    } else {
      setEditUsers([]);
    }
    setEditing(r);

    setMembersLoading(true);
    try {
      const res = await fetch("/api/settings/users");
      if (res.ok) {
        setMembers((await res.json()) as OrgMember[]);
      }
    } finally {
      setMembersLoading(false);
    }
  }

  // Toggle a member in/out of the selected set, preserving click order (the
  // round-robin sequence and ring-all set both read off editUsers).
  function toggleUser(id: string) {
    setEditUsers((prev) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id],
    );
  }

  // Only members with a cell on file are routable — decideShared drops the
  // rest, so they are never offered.
  const selectableMembers = members.filter((m) => m.phone !== null);

  // Build the routable rule from the editor's current selection. Returns null
  // for a kind the editor cannot yet express, so Save is a no-op rather than
  // PATCHing a half-formed rule.
  function buildRule(): InboundRule | null {
    switch (editKind) {
      case "ring-all":
        return { kind: "ring-all", users: editUsers };
      case "round-robin":
        return { kind: "round-robin", sequence: editUsers };
      case "forward":
        return editUsers[0]
          ? { kind: "forward", forwardUserId: editUsers[0] }
          : null;
      case "voicemail":
        return { kind: "voicemail" };
      default:
        return null;
    }
  }

  async function handleSaveRule() {
    if (!editing) return;
    const rule = buildRule();
    if (!rule) return;
    setSaveInFlight(true);
    try {
      const res = await fetch(`/api/phone/numbers/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbound_rule: rule }),
      });
      if (res.ok) {
        setEditing(null);
        await load();
      }
    } finally {
      setSaveInFlight(false);
    }
  }

  const liveRows = useMemo(
    () => rows.filter((r) => r.released_at === null),
    [rows],
  );

  // ADR 0005: a member gets at most one active Personal line, claimed
  // self-service. The "Claim Personal Number" affordance shows only when the
  // viewer owns none — the one-per-member cap is enforced here at the surface
  // (the route would accept a second, but the UI never offers it).
  const ownsActivePersonal = useMemo(
    () =>
      viewerId !== null &&
      liveRows.some((r) => r.kind === "personal" && r.user_id === viewerId),
    [liveRows, viewerId],
  );

  async function handleSearch() {
    setSearching(true);
    setAvailable([]);
    try {
      const res = await fetch(
        `/api/phone/numbers/available?areaCode=${encodeURIComponent(areaCode)}`,
      );
      if (!res.ok) {
        setError("Failed to search for numbers");
        return;
      }
      setAvailable((await res.json()) as AvailableLocalNumber[]);
    } finally {
      setSearching(false);
    }
  }

  async function handleProvision() {
    if (!pickedNumber) return;
    setProvisioning(true);
    try {
      const res = await fetch("/api/phone/numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: pickedNumber.phoneNumber,
          label: label || pickedNumber.friendlyName,
        }),
      });
      if (!res.ok) {
        setError("Failed to provision number");
        return;
      }
      // Reload so the new row appears with the server's canonical fields.
      await load();
      // Reset the dialog state.
      setShowAddDialog(false);
      setAreaCode("");
      setAvailable([]);
      setPickedNumber(null);
      setLabel("");
    } finally {
      setProvisioning(false);
    }
  }

  async function handleClaimSearch() {
    setClaimSearching(true);
    setClaimAvailable([]);
    try {
      const res = await fetch(
        `/api/phone/numbers/available?areaCode=${encodeURIComponent(claimAreaCode)}`,
      );
      if (!res.ok) {
        setError("Failed to search for numbers");
        return;
      }
      setClaimAvailable((await res.json()) as AvailableLocalNumber[]);
    } finally {
      setClaimSearching(false);
    }
  }

  // Claim the picked number as the caller's own Personal line. The body
  // carries only the number + kind='personal'; the route owns it to the
  // authenticated caller, so the client never sends (or could spoof) an owner.
  async function handleClaim() {
    if (!claimPicked) return;
    setClaiming(true);
    try {
      const res = await fetch("/api/phone/numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: claimPicked.phoneNumber,
          kind: "personal",
        }),
      });
      if (!res.ok) {
        setError("Failed to claim number");
        return;
      }
      // A revived re-claim carries the prior owner; a brand-new claim doesn't.
      const result = (await res.json().catch(() => null)) as
        | { previously_owned_by?: string | null }
        | null;
      await load();
      setShowClaimDialog(false);
      setClaimAreaCode("");
      setClaimAvailable([]);
      setClaimPicked(null);
      setReclaimNotice(result?.previously_owned_by ?? null);
    } finally {
      setClaiming(false);
    }
  }

  async function handleReleaseConfirm() {
    if (!releasing) return;
    setReleaseInFlight(true);
    try {
      const res = await fetch(`/api/phone/numbers/${releasing.id}/release`, {
        method: "POST",
      });
      if (!res.ok) {
        setError("Failed to release number");
        return;
      }
      await load();
      setReleasing(null);
    } finally {
      setReleaseInFlight(false);
    }
  }

  // canManage at the surface: Shared → admin; Personal → owner-self (or admin).
  // Mirrors the route's gate so the greeting affordance is offered exactly when
  // a PUT/DELETE would be allowed.
  function canManageRow(r: PhoneNumberRow): boolean {
    if (r.kind === "shared") return isAdmin;
    return isAdmin || r.user_id === viewerId;
  }

  // Open / close the greeting dialog, resetting any pending audio + recorder.
  function openGreeting(r: PhoneNumberRow) {
    setGreetingFor(r);
    setGreetingFile(null);
    setGreetingFileName(null);
    setRecordError(null);
  }
  function closeGreeting() {
    // Drop a live recording if the dialog is dismissed mid-capture.
    recording?.cancel();
    setRecording(null);
    setGreetingFor(null);
    setGreetingFile(null);
    setGreetingFileName(null);
    setRecordError(null);
  }

  // The selected upload replaces any prior pick (uploaded or recorded).
  function handleGreetingFileChange(file: File | null) {
    setGreetingFile(file);
    setGreetingFileName(file?.name ?? null);
  }

  async function handleStartRecording() {
    setRecordError(null);
    try {
      const rec = await startMicWavRecording();
      setRecording(rec);
    } catch {
      setRecordError(
        "Couldn't access the microphone. Check your browser permissions.",
      );
    }
  }

  async function handleStopRecording() {
    if (!recording) return;
    const blob = await recording.stop();
    setRecording(null);
    setGreetingFile(blob);
    setGreetingFileName("greeting.wav");
  }

  // PUT the chosen audio as multipart form-data. A File carries its own name;
  // a recorded Blob is sent as greeting.wav so the server sees a wav upload.
  async function handleGreetingSave() {
    if (!greetingFor || !greetingFile) return;
    setGreetingSaving(true);
    try {
      const form = new FormData();
      if (greetingFile instanceof File) {
        form.append("file", greetingFile);
      } else {
        form.append("file", greetingFile, greetingFileName ?? "greeting.wav");
      }
      const res = await fetch(
        `/api/phone/numbers/${greetingFor.id}/voicemail-greeting`,
        { method: "PUT", body: form },
      );
      if (!res.ok) {
        setError("Failed to save voicemail greeting");
        return;
      }
      await load();
      closeGreeting();
    } finally {
      setGreetingSaving(false);
    }
  }

  async function handleGreetingRemove() {
    if (!greetingFor) return;
    setGreetingRemoving(true);
    try {
      const res = await fetch(
        `/api/phone/numbers/${greetingFor.id}/voicemail-greeting`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setError("Failed to remove voicemail greeting");
        return;
      }
      await load();
      closeGreeting();
    } finally {
      setGreetingRemoving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PhoneIcon size={20} className="text-primary" />
          <h2 className="text-xl font-semibold text-foreground">
            Phone numbers
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {!ownsActivePersonal && (
            <button
              type="button"
              onClick={() => {
                setReclaimNotice(null);
                setShowClaimDialog(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary text-primary text-sm font-medium hover:bg-primary/5"
            >
              <Plus size={16} />
              Claim Personal Number
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowAddDialog(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              <Plus size={16} />
              Add Shared Number
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive text-sm px-3 py-2">
          {error}
        </div>
      )}

      {reclaimNotice && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-md border border-warning/40 bg-warning/5 text-warning text-sm px-3 py-2"
        >
          <span>
            {`Heads up — this number was previously owned by ${reclaimNotice}. Its prior calls and messages stay with that member and won't appear on your line.`}
          </span>
          <button
            type="button"
            onClick={() => setReclaimNotice(null)}
            className="shrink-0 font-medium hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Loading…
        </div>
      ) : liveRows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <PhoneIcon
            size={28}
            className="mx-auto text-muted-foreground mb-3"
          />
          <p className="text-sm text-muted-foreground">
            No phone numbers yet — click <strong>Add Shared Number</strong> to
            provision your first one.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Number</th>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Inbound rule</th>
                <th className="px-3 py-2 font-medium">Monthly cost</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {liveRows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-foreground text-xs">
                      {r.kind === "shared" ? "Shared" : "Personal"}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {formatPhoneNumber(r.e164)}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {r.label ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.kind === "shared"
                      ? "—"
                      : r.user_id === viewerId
                        ? "You"
                        : r.user_id ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    <div className="flex items-center gap-2">
                      <span>
                        {summarizeInboundRule(
                          r.kind === "shared" ? r.inbound_rule : null,
                        )}
                      </span>
                      {isAdmin && r.kind === "shared" && (
                        <button
                          type="button"
                          onClick={() => void openEditor(r)}
                          className="text-primary font-medium hover:underline"
                        >
                          Configure
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {formatCents(r.monthly_cost_cents)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {canManageRow(r) && (
                        <button
                          type="button"
                          onClick={() => openGreeting(r)}
                          className="inline-flex items-center gap-1 text-primary text-xs font-medium hover:underline"
                          title={
                            r.voicemail_greeting_url
                              ? "Custom voicemail greeting set"
                              : "Using the default voicemail greeting"
                          }
                        >
                          <Voicemail size={12} />
                          Greeting
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => setReleasing(r)}
                          className="inline-flex items-center gap-1 text-destructive text-xs font-medium hover:underline"
                        >
                          <Trash2 size={12} />
                          Release
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Shared Number dialog — area code → pick → label → provision. */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-5 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Add Shared Number
            </h3>

            <div className="space-y-2">
              <label
                htmlFor="add-area-code"
                className="text-sm font-medium text-foreground"
              >
                Area code
              </label>
              <div className="flex gap-2">
                <input
                  id="add-area-code"
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value)}
                  placeholder="512"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={handleSearch}
                  disabled={searching || !areaCode}
                  className="rounded-md bg-secondary text-secondary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
            </div>

            {available.length > 0 && (
              <div className="rounded-md border border-border divide-y divide-border max-h-40 overflow-auto">
                {available.map((n) => (
                  <button
                    key={n.phoneNumber}
                    type="button"
                    onClick={() => setPickedNumber(n)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${
                      pickedNumber?.phoneNumber === n.phoneNumber
                        ? "bg-accent"
                        : ""
                    }`}
                  >
                    <div className="font-mono">{n.friendlyName}</div>
                    <div className="text-xs text-muted-foreground">
                      {n.locality ?? "—"}, {n.region ?? "—"}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {pickedNumber && (
              <div className="space-y-2">
                <label
                  htmlFor="add-label"
                  className="text-sm font-medium text-foreground"
                >
                  Label
                </label>
                <input
                  id="add-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Marketing"
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddDialog(false);
                  setAreaCode("");
                  setAvailable([]);
                  setPickedNumber(null);
                  setLabel("");
                }}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProvision}
                disabled={!pickedNumber || provisioning}
                className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {provisioning ? "Provisioning…" : "Provision"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Claim a Personal Number dialog — area code → pick → claim. The
          number is owned by the caller (route-enforced); no owner field. */}
      {showClaimDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-5 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Claim a Personal Number
            </h3>
            <p className="text-sm text-muted-foreground">
              A personal number is your own line — only you can see its calls
              and messages. Pick a number to claim it for yourself.
            </p>

            <div className="space-y-2">
              <label
                htmlFor="claim-area-code"
                className="text-sm font-medium text-foreground"
              >
                Area code
              </label>
              <div className="flex gap-2">
                <input
                  id="claim-area-code"
                  value={claimAreaCode}
                  onChange={(e) => setClaimAreaCode(e.target.value)}
                  placeholder="512"
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={handleClaimSearch}
                  disabled={claimSearching || !claimAreaCode}
                  className="rounded-md bg-secondary text-secondary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                >
                  {claimSearching ? "Searching…" : "Search"}
                </button>
              </div>
            </div>

            {claimAvailable.length > 0 && (
              <div className="rounded-md border border-border divide-y divide-border max-h-40 overflow-auto">
                {claimAvailable.map((n) => (
                  <button
                    key={n.phoneNumber}
                    type="button"
                    onClick={() => setClaimPicked(n)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent ${
                      claimPicked?.phoneNumber === n.phoneNumber
                        ? "bg-accent"
                        : ""
                    }`}
                  >
                    <div className="font-mono">{n.friendlyName}</div>
                    <div className="text-xs text-muted-foreground">
                      {n.locality ?? "—"}, {n.region ?? "—"}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowClaimDialog(false);
                  setClaimAreaCode("");
                  setClaimAvailable([]);
                  setClaimPicked(null);
                }}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClaim}
                disabled={!claimPicked || claiming}
                className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {claiming ? "Claiming…" : "Claim"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Release confirmation. */}
      {releasing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-5 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Release {formatPhoneNumber(releasing.e164)}?
            </h3>
            <p className="text-sm text-muted-foreground">
              This returns the number to Twilio. Inbound and outbound on this
              number will stop immediately. The row is kept for audit.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReleasing(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReleaseConfirm}
                disabled={releaseInFlight}
                className="rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {releaseInFlight ? "Releasing…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voicemail-greeting dialog (slice 13, #317) — upload an audio file or
          record one in the browser (encoded to WAV), then PUT it; or remove an
          existing greeting (DELETE). Twilio <Play> renders mp3/wav only. */}
      {greetingFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-5 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Voicemail greeting — {formatPhoneNumber(greetingFor.e164)}
            </h3>
            <p className="text-sm text-muted-foreground">
              {greetingFor.voicemail_greeting_url
                ? "A custom greeting is set. Upload or record a new one to replace it, or remove it to use the default."
                : "Using the default spoken greeting. Upload an MP3/WAV file or record one to set a custom greeting."}
            </p>

            <div className="space-y-2">
              <label
                htmlFor="greeting-file"
                className="text-sm font-medium text-foreground"
              >
                Upload audio (MP3 or WAV)
              </label>
              <input
                id="greeting-file"
                type="file"
                accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,.mp3,.wav"
                onChange={(e) =>
                  handleGreetingFileChange(e.target.files?.[0] ?? null)
                }
                className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">or</span>
              {recording ? (
                <button
                  type="button"
                  onClick={() => void handleStopRecording()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground"
                >
                  <Square size={14} />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleStartRecording()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
                >
                  <Mic size={14} />
                  Record
                </button>
              )}
              {recording && (
                <span className="inline-flex items-center gap-1 text-xs text-destructive">
                  <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                  Recording…
                </span>
              )}
            </div>

            {greetingFileName && !recording && (
              <p className="text-xs text-muted-foreground">
                Ready to save: <span className="text-foreground">{greetingFileName}</span>
              </p>
            )}
            {recordError && (
              <p className="text-xs text-destructive">{recordError}</p>
            )}

            <div className="flex items-center justify-between gap-2 pt-2">
              <div>
                {greetingFor.voicemail_greeting_url && (
                  <button
                    type="button"
                    onClick={() => void handleGreetingRemove()}
                    disabled={greetingRemoving}
                    className="rounded-md px-3 py-1.5 text-sm font-medium text-destructive hover:underline disabled:opacity-50"
                  >
                    {greetingRemoving ? "Removing…" : "Remove greeting"}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeGreeting}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleGreetingSave()}
                  disabled={!greetingFile || greetingSaving || recording !== null}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {greetingSaving ? "Saving…" : "Save greeting"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Inbound-rule editor — pick an answer rule + (for ring/forward) the
          members to dial. Saves to PATCH /api/phone/numbers/[id]. */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl border border-border w-full max-w-md p-5 space-y-4">
            <h3 className="text-lg font-semibold text-foreground">
              Inbound rule — {formatPhoneNumber(editing.e164)}
            </h3>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground">
                When a call comes in
              </legend>
              {INBOUND_KIND_OPTIONS.map((opt) => (
                <label
                  key={opt.kind}
                  className="flex items-start gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="radio"
                    name="inbound-kind"
                    value={opt.kind}
                    aria-label={opt.label}
                    checked={editKind === opt.kind}
                    onChange={() => setEditKind(opt.kind)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      {opt.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {opt.help}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {editKind !== "voicemail" && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Members</p>
                {membersLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : selectableMembers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No members with a cell on file.
                  </p>
                ) : (
                  selectableMembers.map((m) => {
                    // Forward goes to exactly one member (single-select radio);
                    // ring-all / round-robin select a set (checkboxes).
                    const single = editKind === "forward";
                    return (
                      <label
                        key={m.id}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <input
                          type={single ? "radio" : "checkbox"}
                          name={single ? "forward-member" : undefined}
                          checked={
                            single
                              ? editUsers[0] === m.id
                              : editUsers.includes(m.id)
                          }
                          onChange={() =>
                            single ? setEditUsers([m.id]) : toggleUser(m.id)
                          }
                        />
                        <span className="text-foreground">{m.full_name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveRule()}
                disabled={saveInFlight}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saveInFlight ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
