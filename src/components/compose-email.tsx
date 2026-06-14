"use client";

import { useState, useEffect, useMemo, useRef, useReducer } from "react";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Send,
  ChevronDown,
  ChevronUp,
  Paperclip,
  X,
  FileIcon,
  Save,
  Minus,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { toast } from "sonner";
import TiptapEditor from "@/components/tiptap-editor";
import EmailAddressInput, { EmailAddressInputHandle } from "@/components/email-address-input";
import { htmlToText } from "@/lib/email/html-to-text";
import {
  composeWindowReducer,
  initialComposeWindowState,
} from "@/components/email/compose-window-state";

interface EmailAccountData {
  id: string;
  label: string;
  email_address: string;
  display_name: string;
  signature: string | null;
  is_default: boolean;
  is_active: boolean;
}

interface Recipient {
  email: string;
  name: string;
}

interface UploadedFile {
  filename: string;
  content_type: string;
  file_size: number;
  storage_path: string;
}

interface ComposeEmailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId?: string;
  draftId?: string;
  defaultTo?: string;
  defaultCc?: string;
  defaultBcc?: string;
  defaultSubject?: string;
  defaultBody?: string;
  defaultAccountId?: string;
  replyToMessageId?: string;
  mode?: "compose" | "reply" | "forward";
  onSent?: () => void;
  defaultAttachments?: UploadedFile[];
}

export default function ComposeEmailModal({
  open,
  onOpenChange,
  jobId,
  draftId: initialDraftId,
  defaultTo = "",
  defaultCc = "",
  defaultBcc = "",
  defaultSubject = "",
  defaultBody = "",
  defaultAccountId,
  replyToMessageId,
  mode = "compose",
  onSent,
  defaultAttachments = [],
}: ComposeEmailProps) {
  const [accounts, setAccounts] = useState<EmailAccountData[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [toRecipients, setToRecipients] = useState<Recipient[]>([]);
  const [ccRecipients, setCcRecipients] = useState<Recipient[]>([]);
  const [bccRecipients, setBccRecipients] = useState<Recipient[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [bodyHtml, setBodyHtml] = useState("");
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(initialDraftId || null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [windowState, dispatchWindow] = useReducer(
    composeWindowReducer,
    initialComposeWindowState,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<EmailAddressInputHandle>(null);
  const ccRef = useRef<EmailAddressInputHandle>(null);
  const bccRef = useRef<EmailAddressInputHandle>(null);

  // Keep refs in sync so handleSend always reads current values
  const toRecipientsRef = useRef(toRecipients);
  toRecipientsRef.current = toRecipients;
  const ccRecipientsRef = useRef(ccRecipients);
  ccRecipientsRef.current = ccRecipients;
  const bccRecipientsRef = useRef(bccRecipients);
  bccRecipientsRef.current = bccRecipients;

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  );

  // Signature data from email_signatures table
  const [signaturesMap, setSignaturesMap] = useState<Record<string, { signature_html: string; auto_insert: boolean }>>({});

  // Build initial body with signature
  function buildInitialBody(account: EmailAccountData | undefined, quotedHtml: string, sigs?: typeof signaturesMap) {
    let html = "";
    if (quotedHtml) {
      html = quotedHtml;
    }
    const sigData = (sigs || signaturesMap)[account?.id || ""];
    const sigHtml = sigData?.auto_insert !== false ? sigData?.signature_html : null;
    const fallbackSig = account?.signature;
    const effectiveSig = sigHtml || fallbackSig;

    if (effectiveSig) {
      const rendered = effectiveSig.includes("<")
        ? effectiveSig
        : `<p>${effectiveSig.replace(/\n/g, "<br>")}</p>`;
      html = `<p></p><br><div style="border-top: 1px solid #ccc; padding-top: 8px; margin-top: 16px; color: #666;">${rendered}</div>${html ? `<br>${html}` : ""}`;
    }
    return html;
  }

  useEffect(() => {
    if (open) {
      // Each fresh open starts as the corner-docked panel.
      dispatchWindow({ type: "reset" });
      setSubject(defaultSubject);
      setUploadedFiles(defaultAttachments);
      setDraftId(initialDraftId || null);

      // Set To recipients
      if (defaultTo) {
        const toEmails = defaultTo.split(",").map((e) => e.trim()).filter(Boolean);
        setToRecipients(toEmails.map((email) => ({ email, name: "" })));
      } else {
        setToRecipients([]);
      }

      // Set CC recipients (for Reply All)
      if (defaultCc) {
        const ccEmails = defaultCc.split(",").map((e) => e.trim()).filter(Boolean);
        setCcRecipients(ccEmails.map((email) => ({ email, name: "" })));
        setShowCcBcc(true);
      } else {
        setCcRecipients([]);
        setShowCcBcc(false);
      }

      // Set BCC recipients (for draft resume)
      if (defaultBcc) {
        const bccEmails = defaultBcc.split(",").map((e) => e.trim()).filter(Boolean);
        setBccRecipients(bccEmails.map((email) => ({ email, name: "" })));
        setShowCcBcc(true);
      } else {
        setBccRecipients([]);
      }

      // Fetch accounts and signatures
      Promise.all([
        fetch("/api/email/accounts").then((r) => r.ok ? r.json() : null),
        fetch("/api/settings/signatures").then((r) => r.ok ? r.json() : null),
      ]).then(([accountsData, sigsData]) => {
        if (!accountsData || !Array.isArray(accountsData)) return;
        const active = accountsData.filter((a: EmailAccountData) => a.is_active);
        setAccounts(active);

        // Build signatures map
        const sigs: Record<string, { signature_html: string; auto_insert: boolean }> = {};
        if (Array.isArray(sigsData)) {
          for (const s of sigsData) {
            if (s.signature) {
              sigs[s.id] = { signature_html: s.signature.signature_html, auto_insert: s.signature.auto_insert };
            }
          }
        }
        setSignaturesMap(sigs);

        // Pick account
        const defaultAcc = (defaultAccountId && active.find((a: EmailAccountData) => a.id === defaultAccountId))
          || active.find((a: EmailAccountData) => a.is_default)
          || active[0];
        if (defaultAcc) {
          setSelectedAccountId(defaultAcc.id);
          setBodyHtml(buildInitialBody(defaultAcc, defaultBody, sigs));
          setEditorKey((k) => k + 1);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTo, defaultCc, defaultBcc, defaultSubject, defaultBody, defaultAccountId, initialDraftId]);

  // Handle file upload
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`${file.name} is too large (max 25MB)`);
        continue;
      }
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await fetch("/api/email/attachments/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (res.ok) {
          setUploadedFiles((prev) => [...prev, data]);
        } else {
          toast.error(data.error || `Failed to upload ${file.name}`);
        }
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
    // Reset the input so the same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Save draft
  async function handleSaveDraft() {
    if (!selectedAccountId) {
      toast.error("No email account selected.");
      return;
    }
    toRef.current?.flush();
    ccRef.current?.flush();
    bccRef.current?.flush();
    const currentTo = toRecipientsRef.current;
    const currentCc = ccRecipientsRef.current;
    const currentBcc = bccRecipientsRef.current;

    const bodyText = htmlToText(bodyHtml);

    setSavingDraft(true);
    try {
      const res = await fetch("/api/email/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draftId || undefined,
          accountId: selectedAccountId,
          to: currentTo.map((r) => r.email).join(", "),
          cc: currentCc.length > 0 ? currentCc.map((r) => r.email).join(", ") : undefined,
          bcc: currentBcc.length > 0 ? currentBcc.map((r) => r.email).join(", ") : undefined,
          subject,
          bodyText,
          bodyHtml,
          jobId: jobId || undefined,
          replyToMessageId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setDraftId(data.id);
        toast.success("Draft saved.");
        onOpenChange(false);
        onSent?.();
      } else {
        toast.error(data.error || "Failed to save draft.");
      }
    } catch {
      toast.error("Failed to save draft.");
    }
    setSavingDraft(false);
  }

  // Update signature when account changes
  function handleAccountChange(accountId: string) {
    setSelectedAccountId(accountId);
    const account = accounts.find((a) => a.id === accountId);
    // Reset body with new signature (preserve user content before sig)
    setBodyHtml(buildInitialBody(account, defaultBody));
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    // Commit any typed-but-uncommitted email addresses
    toRef.current?.flush();
    ccRef.current?.flush();
    bccRef.current?.flush();

    // Read from refs to get post-flush values (closures may be stale)
    const currentTo = toRecipientsRef.current;
    const currentCc = ccRecipientsRef.current;
    const currentBcc = bccRecipientsRef.current;

    if (!selectedAccountId || currentTo.length === 0 || !subject) {
      toast.error("Please fill in To and Subject fields.");
      return;
    }

    const bodyText = htmlToText(bodyHtml);

    if (!bodyText.trim()) {
      toast.error("Please write a message.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: selectedAccountId,
          jobId: jobId || undefined,
          to: currentTo.map((r) => r.email).join(", "),
          cc: currentCc.length > 0 ? currentCc.map((r) => r.email).join(", ") : undefined,
          bcc: currentBcc.length > 0 ? currentBcc.map((r) => r.email).join(", ") : undefined,
          subject,
          body: bodyText,
          bodyHtml,
          replyToMessageId,
          attachments: uploadedFiles.length > 0 ? uploadedFiles : undefined,
          draftId: draftId || undefined,
        }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        toast.error(`Server error (${res.status}). Check email settings and try again.`);
        setSending(false);
        return;
      }

      if (res.ok) {
        toast.success("Email sent successfully.");
        onOpenChange(false);
        onSent?.();
      } else {
        toast.error(data.error || "Failed to send email.");
      }
    } catch {
      toast.error("Network error sending email.");
    }
    setSending(false);
  }

  const title =
    mode === "reply" ? "Reply" : mode === "forward" ? "Forward" : "Compose Email";

  if (!open) return null;

  const isMaximized = windowState.mode === "maximized";
  const isMinimized = windowState.mode === "minimized";

  const panelClass = [
    "fixed z-50 flex flex-col bg-white shadow-2xl border border-gray-200 overflow-hidden",
    isMinimized
      ? "bottom-0 left-0 right-0 sm:left-auto sm:right-6 sm:w-[600px] rounded-t-xl"
      : isMaximized
        ? "inset-0 sm:inset-4 sm:rounded-xl"
        : "inset-0 sm:inset-auto sm:bottom-0 sm:right-6 sm:w-[600px] sm:h-[85vh] sm:max-h-[760px] sm:rounded-t-xl",
  ].join(" ");

  return (
    <div
      role="dialog"
      aria-modal={false}
      aria-label={title}
      className={panelClass}
    >
      {/* Title bar — window chrome with minimize / maximize / close */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-[#2B5EA7] text-white shrink-0 select-none">
        {isMinimized ? (
          <button
            type="button"
            onClick={() => dispatchWindow({ type: "restore" })}
            className="min-w-0 flex-1 text-left text-sm font-semibold truncate"
            title="Restore"
          >
            {title}
          </button>
        ) : (
          <span className="min-w-0 flex-1 text-sm font-semibold truncate">
            {title}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() =>
              dispatchWindow({ type: isMinimized ? "restore" : "minimize" })
            }
            title={isMinimized ? "Restore" : "Minimize"}
            aria-label={isMinimized ? "Restore" : "Minimize"}
            className="p-1.5 rounded hover:bg-white/15 transition-colors"
          >
            {isMinimized ? <ChevronUp size={15} /> : <Minus size={15} />}
          </button>
          <button
            type="button"
            onClick={() => dispatchWindow({ type: "toggleMaximize" })}
            title={isMaximized ? "Restore down" : "Maximize"}
            aria-label={isMaximized ? "Restore down" : "Maximize"}
            className="p-1.5 rounded hover:bg-white/15 transition-colors"
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            title="Close"
            aria-label="Close"
            className="p-1.5 rounded hover:bg-white/15 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body + footer stay mounted while minimized (hidden via CSS) so the
          in-progress draft — recipients, subject, body, attachments — survives. */}
      <form
        onSubmit={handleSend}
        className={`flex-1 min-h-0 flex flex-col ${isMinimized ? "hidden" : ""}`}
      >
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {/* From account */}
          <div>
            <label className="block text-sm font-medium text-[#333] mb-1">
              From
            </label>
            {accounts.length === 0 ? (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                No email accounts configured.{" "}
                <a href="/settings/email" className="underline font-medium">
                  Add one in Settings.
                </a>
              </p>
            ) : (
              <select
                value={selectedAccountId}
                onChange={(e) => handleAccountChange(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B5EA7]/30 focus:border-[#2B5EA7]"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.display_name || acc.label} &lt;{acc.email_address}&gt;
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* To */}
          <EmailAddressInput
            ref={toRef}
            label="To"
            recipients={toRecipients}
            onChange={setToRecipients}
            placeholder="Type name or email..."
          />

          {/* CC/BCC toggle */}
          <button
            type="button"
            onClick={() => setShowCcBcc(!showCcBcc)}
            className="flex items-center gap-1 text-xs text-[#2B5EA7] hover:underline"
          >
            {showCcBcc ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showCcBcc ? "Hide CC/BCC" : "Add CC/BCC"}
          </button>

          {showCcBcc && (
            <>
              <EmailAddressInput
                ref={ccRef}
                label="CC"
                recipients={ccRecipients}
                onChange={setCcRecipients}
                placeholder="Add CC recipients..."
              />
              <EmailAddressInput
                ref={bccRef}
                label="BCC"
                recipients={bccRecipients}
                onChange={setBccRecipients}
                placeholder="Add BCC recipients..."
              />
            </>
          )}

          {/* Subject */}
          <div>
            <label className="block text-sm font-medium text-[#333] mb-1">
              Subject
            </label>
            <Input
              required
              placeholder="Email subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Rich text body */}
          <div>
            <label className="block text-sm font-medium text-[#333] mb-1">
              Message
            </label>
            <TiptapEditor
              key={editorKey}
              content={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Type your message..."
            />
          </div>

          {/* Attachments */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
            {uploadedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {uploadedFiles.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 bg-gray-100 text-[#333] text-xs px-2.5 py-1.5 rounded-lg"
                  >
                    <FileIcon size={12} className="text-[#999] shrink-0" />
                    <span className="truncate max-w-[180px]">{f.filename}</span>
                    <span className="text-[#999]">
                      ({(f.file_size / 1024).toFixed(0)}KB)
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="hover:text-red-600 ml-0.5"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Signature preview */}
          {selectedAccount?.signature && (
            <p className="text-xs text-[#999]">
              Signature from &quot;{selectedAccount.label}&quot; will be included.
            </p>
          )}

        </div>

        {/* Footer action / send bar */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-t border-gray-200 bg-white">
          <button
            type="submit"
            disabled={sending || uploading || accounts.length === 0}
            className="px-5 py-2.5 bg-[#2B5EA7] text-white rounded-lg text-sm font-medium hover:bg-[#234b87] disabled:opacity-50 flex items-center gap-2"
          >
            {sending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            Send Email
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-[#666666] hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Paperclip size={14} />
            )}
            Attach
          </button>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={savingDraft || accounts.length === 0}
            className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-[#666666] hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50"
          >
            {savingDraft ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save Draft
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-[#666666] hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
