"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Mail, Image as ImageIcon, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import TiptapEditor from "@/components/tiptap-editor";

interface SignatureData {
  id?: string;
  account_id: string;
  signature_html: string;
  include_logo: boolean;
  auto_insert: boolean;
}

interface AccountWithSig {
  id: string;
  label: string;
  email_address: string;
  display_name: string;
  is_active: boolean;
  signature: SignatureData | null;
}

export function SignaturesTab() {
  const [accounts, setAccounts] = useState<AccountWithSig[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sigHtml, setSigHtml] = useState("");
  const [includeLogo, setIncludeLogo] = useState(true);
  const [autoInsert, setAutoInsert] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  // Company info for auto-insert
  const [companyInfo, setCompanyInfo] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    const [sigRes, companyRes] = await Promise.all([
      fetch("/api/settings/signatures"),
      fetch("/api/settings/company"),
    ]);

    if (sigRes.ok) {
      const data = await sigRes.json();
      setAccounts(Array.isArray(data) ? data : []);
      // Select first account if none selected
      if (!selectedId && data.length > 0) {
        selectAccount(data[0]);
      }
    }

    if (companyRes.ok) {
      const info = await companyRes.json();
      setCompanyInfo(info || {});
    }

    setLoading(false);
  }, [selectedId]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectAccount(acc: AccountWithSig) {
    setSelectedId(acc.id);
    setSigHtml(acc.signature?.signature_html || "");
    setIncludeLogo(acc.signature?.include_logo ?? true);
    setAutoInsert(acc.signature?.auto_insert ?? true);
    setEditorKey((k) => k + 1);
  }

  function handleAutoFill() {
    const name = companyInfo.company_name || "AAA Disaster Recovery";
    const phone = companyInfo.phone || "";
    const website = companyInfo.website || "";
    const email = companyInfo.email || "";

    let html = `<p><strong>${name}</strong></p>`;
    const details: string[] = [];
    if (phone) details.push(phone);
    if (email) details.push(email);
    if (website) details.push(website);
    if (details.length > 0) {
      html += `<p>${details.join(" | ")}</p>`;
    }

    setSigHtml(html);
    setEditorKey((k) => k + 1);
    toast.success("Signature populated from Company Profile");
  }

  async function handleSave() {
    if (!selectedId) return;
    setSaving(true);

    const res = await fetch("/api/settings/signatures", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: selectedId,
        signature_html: sigHtml,
        include_logo: includeLogo,
        auto_insert: autoInsert,
      }),
    });

    if (res.ok) {
      toast.success("Signature saved");
      // Update local state
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === selectedId
            ? {
                ...a,
                signature: {
                  account_id: selectedId,
                  signature_html: sigHtml,
                  include_logo: includeLogo,
                  auto_insert: autoInsert,
                },
              }
            : a
        )
      );
    } else {
      toast.error("Failed to save signature");
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  if (accounts.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Email Signatures</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure signatures for your email accounts.
          </p>
        </div>
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <Mail size={48} className="mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">No email accounts configured.</p>
          <a href="/settings/email" className="text-sm text-accent-text hover:underline mt-1 inline-block">
            Add an email account first
          </a>
        </div>
      </div>
    );
  }

  const selectedAccount = accounts.find((a) => a.id === selectedId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Email Signatures</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure rich text signatures for each email account.
        </p>
      </div>

      {/* Account selector */}
      <div className="flex gap-2 flex-wrap">
        {accounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => selectAccount(acc)}
            className={cn(
              "px-3 py-2 rounded-lg text-sm font-medium border transition-all",
              selectedId === acc.id
                ? "bg-accent-tint text-accent-text border-transparent"
                : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
            )}
          >
            <span className="flex items-center gap-2">
              <Mail size={14} />
              {acc.label}
            </span>
            <span className="text-[11px] opacity-60 block">{acc.email_address}</span>
          </button>
        ))}
      </div>

      {selectedAccount && (
        <>
          {/* Signature editor */}
          <div className="bg-card rounded-xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <label className="text-sm font-medium text-foreground">
                Signature for {selectedAccount.label}
              </label>
              <button
                onClick={handleAutoFill}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Send size={12} />
                Auto-fill from Company Profile
              </button>
            </div>
            <TiptapEditor
              key={editorKey}
              content={sigHtml}
              onChange={setSigHtml}
              placeholder="Type your email signature..."
            />
          </div>

          {/* Toggles */}
          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <Send size={16} className="text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Auto-insert on new emails</p>
                  <p className="text-xs text-muted-foreground">Automatically append this signature when composing</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={autoInsert}
                onChange={(e) => setAutoInsert(e.target.checked)}
                className="w-5 h-5 rounded border-border accent-primary"
              />
            </label>

            <div className="border-t border-border" />

            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <ImageIcon size={16} className="text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Include company logo</p>
                  <p className="text-xs text-muted-foreground">Add your logo from Company Profile above the signature</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={includeLogo}
                onChange={(e) => setIncludeLogo(e.target.checked)}
                className="w-5 h-5 rounded border-border accent-primary"
              />
            </label>
          </div>

          {/* Preview — always rendered on white bg to match how emails look */}
          {sigHtml && (
            <div className="bg-card rounded-xl border border-border p-6">
              <label className="block text-sm font-medium text-foreground mb-3">Preview</label>
              <div className="border border-border rounded-lg p-4 bg-white">
                <div className="border-t border-border/50 pt-3 mt-2">
                  <div
                    className="text-sm text-gray-600 prose prose-sm max-w-none [&_*]:!text-gray-700 [&_strong]:!text-gray-900"
                    dangerouslySetInnerHTML={{ __html: sigHtml }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Save */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {saving ? "Saving..." : "Save Signature"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
