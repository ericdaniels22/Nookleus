"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Mail,
  Loader2,
  Lock,
  Building2,
  User,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import TiptapEditor from "@/components/tiptap-editor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Scope = "organization" | "personal";

interface EmailTemplate {
  id: string;
  name: string;
  body_html: string;
  owner_user_id: string | null;
  updated_at: string;
}

// The active editor target. `id` absent → creating; present → editing.
interface EditorState {
  id?: string;
  scope: Scope;
  name: string;
  body_html: string;
}

export function TemplatesTab() {
  const { hasPermission } = useAuth();
  // Org-wide templates are visible to every member; only managing them needs
  // the permission. Personal templates are always the owner's to manage.
  const canManageOrg = hasPermission("manage_email_templates");

  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/email/templates");
    if (res.ok) {
      setTemplates((await res.json()) as EmailTemplate[]);
    } else {
      toast.error("Failed to load templates");
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openEditor(state: EditorState) {
    setEditor(state);
    setEditorKey((k) => k + 1);
  }

  async function handleSave() {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) {
      toast.error("Give the template a name");
      return;
    }
    setSaving(true);
    const res = editor.id
      ? await fetch(`/api/email/templates/${editor.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, body_html: editor.body_html }),
        })
      : await fetch("/api/email/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: editor.scope, name, body_html: editor.body_html }),
        });
    setSaving(false);

    if (res.ok) {
      toast.success(editor.id ? "Template saved" : "Template created");
      setEditor(null);
      refresh();
    } else if (res.status === 403) {
      toast.error("You don't have permission to manage organization templates");
    } else {
      toast.error("Failed to save template");
    }
  }

  async function handleDelete(t: EmailTemplate) {
    const res = await fetch(`/api/email/templates/${t.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Template deleted");
      if (editor?.id === t.id) setEditor(null);
      refresh();
    } else if (res.status === 403) {
      toast.error("You don't have permission to delete this template");
    } else {
      toast.error("Failed to delete template");
    }
  }

  const orgTemplates = (templates ?? []).filter((t) => t.owner_user_id === null);
  const personalTemplates = (templates ?? []).filter((t) => t.owner_user_id !== null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Email Templates</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Reusable email bodies you can drop into a new message. Organization
          templates are shared with your whole team; personal templates are
          only yours.
        </p>
      </div>

      {templates === null ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 size={20} className="inline animate-spin mr-2" /> Loading templates…
        </div>
      ) : (
        <>
          <TemplateSection
            icon={<Building2 size={16} className="text-[var(--brand-primary)]" />}
            title="Organization templates"
            description="Shared across everyone in your organization."
            templates={orgTemplates}
            canManage={canManageOrg}
            lockedHint={
              <span>
                Viewing only. Managing organization templates needs
                <span className="font-mono text-xs"> manage_email_templates</span>.
              </span>
            }
            onNew={() => openEditor({ scope: "organization", name: "", body_html: "" })}
            onEdit={(t) =>
              openEditor({ id: t.id, scope: "organization", name: t.name, body_html: t.body_html })
            }
            onDelete={handleDelete}
            editingId={editor?.id}
          />

          <TemplateSection
            icon={<User size={16} className="text-[var(--brand-primary)]" />}
            title="Personal templates"
            description="Private to you — no one else can see or use them."
            templates={personalTemplates}
            canManage={true}
            onNew={() => openEditor({ scope: "personal", name: "", body_html: "" })}
            onEdit={(t) =>
              openEditor({ id: t.id, scope: "personal", name: t.name, body_html: t.body_html })
            }
            onDelete={handleDelete}
            editingId={editor?.id}
          />
        </>
      )}

      {/* Inline editor */}
      {editor && (
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <div className="flex items-center gap-2">
            {editor.scope === "organization" ? (
              <Building2 size={16} className="text-[var(--brand-primary)]" />
            ) : (
              <User size={16} className="text-[var(--brand-primary)]" />
            )}
            <h3 className="text-sm font-semibold text-foreground">
              {editor.id ? "Edit" : "New"}{" "}
              {editor.scope === "organization" ? "organization" : "personal"} template
            </h3>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Name
            </label>
            <input
              type="text"
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              placeholder="e.g. Follow-up after estimate"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary/40 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Body
            </label>
            <TiptapEditor
              key={editorKey}
              content={editor.body_html}
              onChange={(html) => setEditor((prev) => (prev ? { ...prev, body_html: html } : prev))}
              placeholder="Write the email body…"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditor(null)}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium border border-input bg-transparent text-text-secondary hover:bg-muted hover:text-foreground disabled:opacity-50 transition-all"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving ? "Saving…" : editor.id ? "Save template" : "Create template"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateSection({
  icon,
  title,
  description,
  templates,
  canManage,
  lockedHint,
  onNew,
  onEdit,
  onDelete,
  editingId,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  templates: EmailTemplate[];
  canManage: boolean;
  lockedHint?: React.ReactNode;
  onNew: () => void;
  onEdit: (t: EmailTemplate) => void;
  onDelete: (t: EmailTemplate) => void;
  editingId?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            {icon}
            {title}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={onNew}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
          >
            <Plus size={16} /> New
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock size={12} /> View only
          </span>
        )}
      </div>

      {!canManage && lockedHint && (
        <p className="text-xs text-muted-foreground">{lockedHint}</p>
      )}

      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
          <Mail size={28} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-foreground font-medium">No templates yet</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {templates.map((t) => (
                <tr
                  key={t.id}
                  className={
                    "border-t border-border first:border-t-0 hover:bg-muted/20 transition-colors" +
                    (editingId === t.id ? " bg-muted/30" : "")
                  }
                >
                  <td className="px-4 py-3">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => onEdit(t)}
                        className="font-medium text-foreground hover:text-[var(--brand-primary)] transition-colors text-left"
                      >
                        {t.name}
                      </button>
                    ) : (
                      <span className="font-medium text-foreground">{t.name}</span>
                    )}
                  </td>
                  <td className="w-10 px-2 py-3 text-right">
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="inline-flex items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                          aria-label={`Actions for ${t.name}`}
                        >
                          <MoreHorizontal size={16} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem onClick={() => onEdit(t)}>
                            <Pencil size={14} /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => onDelete(t)}>
                            <Trash2 size={14} /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
