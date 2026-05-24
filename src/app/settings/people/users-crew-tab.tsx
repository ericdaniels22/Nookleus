"use client";

import { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { formatPhoneNumber } from "@/lib/phone";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Plus,
  Users,
  Shield,
  UserCheck,
  UserX,
  Loader2,
  Mail,
  Phone,
  KeyRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
} from "@/lib/permissions/permission-keys";

interface UserProfile {
  id: string;
  full_name: string;
  email?: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "crew_lead", label: "Crew Lead" },
  { value: "crew_member", label: "Crew Member" },
];

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-[#FCEBEB] text-[#791F1F]",
  crew_lead: "bg-[#FAEEDA] text-[#633806]",
  crew_member: "bg-[#E6F1FB] text-[#0C447C]",
  custom: "bg-[#EEEDFE] text-[#3C3489]",
};

// The permission vocabulary is the canonical PERMISSION_CATALOG — the same
// keys route gates check, so the management UI cannot drift from the gates.

export function UsersCrewTab() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState("crew_member");
  const [inviting, setInviting] = useState(false);

  // Password reset
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [resetUserName, setResetUserName] = useState("");

  // Permissions dialog
  const [permUserId, setPermUserId] = useState<string | null>(null);
  const [permUserName, setPermUserName] = useState("");
  const [permUserRole, setPermUserRole] = useState("");
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [savingPerms, setSavingPerms] = useState(false);

  const fetchUsers = useCallback(async () => {
    const res = await fetch("/api/settings/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleInvite() {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      toast.error("Name and email are required");
      return;
    }
    setInviting(true);
    const res = await fetch("/api/settings/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: inviteEmail.trim(),
        full_name: inviteName.trim(),
        phone: invitePhone.trim() || null,
        role: inviteRole,
      }),
    });
    if (res.ok) {
      toast.success(`${inviteName} has been added`);
      setShowInvite(false);
      setInviteName("");
      setInviteEmail("");
      setInvitePhone("");
      setInviteRole("crew_member");
      fetchUsers();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to invite user");
    }
    setInviting(false);
  }

  async function toggleActive(user: UserProfile) {
    const res = await fetch(`/api/settings/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !user.is_active }),
    });
    if (res.ok) {
      toast.success(user.is_active ? "User deactivated" : "User reactivated");
      fetchUsers();
    } else {
      toast.error("Failed to update user status");
    }
  }

  async function sendReset(user: UserProfile) {
    setResettingId(user.id);
    const res = await fetch(`/api/settings/users/${user.id}/reset-password`, {
      method: "POST",
    });
    if (res.ok) {
      const data = await res.json();
      setResetUserName(user.full_name);
      setResetLink(data.link);
      try {
        await navigator.clipboard.writeText(data.link);
        toast.success("Reset link copied to clipboard");
      } catch {
        toast.success("Reset link generated");
      }
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to generate reset link");
    }
    setResettingId(null);
  }

  async function openPermissions(user: UserProfile) {
    setPermUserId(user.id);
    setPermUserName(user.full_name);
    setPermUserRole(user.role);
    const res = await fetch(`/api/settings/users/${user.id}/permissions`);
    if (res.ok) {
      setPerms(await res.json());
    }
  }

  async function savePermissions() {
    if (!permUserId) return;
    setSavingPerms(true);
    const res = await fetch(`/api/settings/users/${permUserId}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(perms),
    });
    if (res.ok) {
      toast.success("Permissions saved");
      setPermUserId(null);
    } else {
      toast.error("Failed to save permissions");
    }
    setSavingPerms(false);
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Users & Crew</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage team members and their permissions.
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all"
        >
          <Plus size={16} />
          Add User
        </button>
      </div>

      {/* User list */}
      {users.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <Users size={48} className="mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">No users yet. Add your first team member.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className={cn(
                "bg-card rounded-xl border border-border p-4",
                !user.is_active && "opacity-50"
              )}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-sm font-semibold text-muted-foreground">
                      {user.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground truncate">
                        {user.full_name}
                      </h3>
                      <Badge className={cn("text-[10px] px-1.5 py-0 rounded-full", ROLE_COLORS[user.role] || ROLE_COLORS.custom)}>
                        {ROLES.find((r) => r.value === user.role)?.label || user.role}
                      </Badge>
                      {!user.is_active && (
                        <Badge className="text-[10px] px-1.5 py-0 rounded-full bg-muted text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      {user.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail size={11} /> {user.email}
                        </span>
                      )}
                      {user.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone size={11} /> {formatPhoneNumber(user.phone)}
                        </span>
                      )}
                      {user.last_login_at && (
                        <span>Last login: {format(new Date(user.last_login_at), "MMM d, yyyy")}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => sendReset(user)}
                    disabled={resettingId === user.id}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                    title="Get password reset link"
                  >
                    {resettingId === user.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <KeyRound size={14} />
                    )}
                  </button>
                  <button
                    onClick={() => openPermissions(user)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title="Permissions"
                  >
                    <Shield size={14} />
                  </button>
                  <button
                    onClick={() => toggleActive(user)}
                    className={cn(
                      "p-1.5 rounded-lg transition-colors",
                      user.is_active
                        ? "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                    )}
                    title={user.is_active ? "Deactivate" : "Reactivate"}
                  >
                    {user.is_active ? <UserX size={14} /> : <UserCheck size={14} />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Full Name *</label>
              <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="John Smith" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Email *</label>
              <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="john@company.com" type="email" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Phone</label>
              <Input value={invitePhone} onChange={(e) => setInvitePhone(e.target.value)} placeholder="(555) 123-4567" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Role</label>
              <div className="flex gap-2">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setInviteRole(r.value)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                      inviteRole === r.value
                        ? ROLE_COLORS[r.value] + " border-current"
                        : "bg-card text-muted-foreground border-border"
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:bg-accent">
              Cancel
            </DialogClose>
            <button
              onClick={handleInvite}
              disabled={inviting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-50 transition-all"
            >
              {inviting && <Loader2 size={14} className="animate-spin" />}
              Add User
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permissions Dialog */}
      <Dialog open={!!permUserId} onOpenChange={(open) => !open && setPermUserId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Permissions — {permUserName}</DialogTitle>
          </DialogHeader>
          {permUserRole === "admin" ? (
            <p className="text-sm text-muted-foreground py-4">
              Admins have all permissions by default and cannot be restricted.
            </p>
          ) : (
            <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
              {PERMISSION_GROUPS.map((group) => {
                const groupPerms = PERMISSION_CATALOG.filter((p) => p.group === group);
                if (groupPerms.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{group}</p>
                    <div className="space-y-1.5">
                      {groupPerms.map((perm) => (
                        <label
                          key={perm.key}
                          className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-accent cursor-pointer"
                        >
                          <span className="text-sm text-foreground">{perm.label}</span>
                          <input
                            type="checkbox"
                            checked={perms[perm.key] || false}
                            onChange={(e) => setPerms({ ...perms, [perm.key]: e.target.checked })}
                            className="w-4 h-4 rounded border-border accent-[var(--brand-primary)]"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <DialogClose className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:bg-accent">
              Cancel
            </DialogClose>
            {permUserRole !== "admin" && (
              <button
                onClick={savePermissions}
                disabled={savingPerms}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:opacity-50 transition-all"
              >
                {savingPerms && <Loader2 size={14} className="animate-spin" />}
                Save Permissions
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Link Dialog */}
      <Dialog open={!!resetLink} onOpenChange={(open) => !open && setResetLink(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Password reset link — {resetUserName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Send this link to {resetUserName} — text, email, or however you
              reach them. They open it to set their password. The link expires
              in about an hour, so share it soon.
            </p>
            <div className="flex items-center gap-2">
              <Input
                value={resetLink ?? ""}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={async () => {
                  if (!resetLink) return;
                  try {
                    await navigator.clipboard.writeText(resetLink);
                    toast.success("Copied");
                  } catch {
                    toast.error("Couldn't copy — select the link and copy it manually");
                  }
                }}
                className="px-3 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:bg-accent shrink-0"
              >
                Copy
              </button>
            </div>
          </div>
          <DialogFooter>
            <DialogClose className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:bg-accent">
              Done
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
