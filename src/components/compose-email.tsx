"use client";

import { useState, useEffect, useMemo, useRef, useReducer, useCallback } from "react";
import {
  Loader2,
  Send,
  ChevronUp,
  Paperclip,
  X,
  FileIcon,
  Check,
  Minus,
  Maximize2,
  Minimize2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import TiptapEditor from "@/components/tiptap-editor";
import ComposeFormattingToolbar from "@/components/email/compose-formatting-toolbar";
import { composeRichExtensions } from "@/components/email/compose-editor-extensions";
import { type Editor } from "@tiptap/react";
import EmailAddressInput, { EmailAddressInputHandle } from "@/components/email-address-input";
import ContactPicker from "@/components/email/contact-picker";
import { htmlToText } from "@/lib/email/html-to-text";
import {
  createDraftAutosaveScheduler,
  type DraftAutosaveScheduler,
  type DraftSnapshot,
  type DraftSaveStatus,
} from "@/lib/email/draft-autosave";
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
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [bodyHtml, setBodyHtml] = useState("");
  const [sending, setSending] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<DraftSaveStatus>("idle");
  const [draftId, setDraftId] = useState<string | null>(initialDraftId || null);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  // Opt-in rich-formatting extensions for the bottom toolbar. Stable across
  // renders so the shared editor isn't rebuilt; only compose loads these.
  const richExtensions = useMemo(() => composeRichExtensions(), []);
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

  // Automatic draft autosave (issue #641). The decision logic lives in the pure
  // scheduler; this component is the thin shell that baselines on open, feeds
  // edits, flushes on close, cancels on send, and renders the status. The
  // scheduler instance is created once and reused across opens (reset() re-
  // baselines each open). `armedRef` gates edits until the opened content has
  // settled, so opening (incl. an auto-inserted signature) never autosaves.
  const armedRef = useRef(false);
  const schedulerRef = useRef<DraftAutosaveScheduler | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = createDraftAutosaveScheduler({
      onStatusChange: setAutosaveStatus,
      save: async (payload) => {
        const res = await fetch("/api/email/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Draft autosave failed");
        const data = await res.json();
        setDraftId(data.id);
        return { id: data.id };
      },
    });
  }

  const buildSnapshot = useCallback(
    (): DraftSnapshot => ({
      accountId: selectedAccountId,
      to: toRecipients.map((r) => r.email).join(", "),
      cc: ccRecipients.length > 0 ? ccRecipients.map((r) => r.email).join(", ") : undefined,
      bcc: bccRecipients.length > 0 ? bccRecipients.map((r) => r.email).join(", ") : undefined,
      subject,
      bodyText: htmlToText(bodyHtml),
      bodyHtml,
      jobId: jobId || undefined,
      replyToMessageId,
    }),
    [selectedAccountId, toRecipients, ccRecipients, bccRecipients, subject, bodyHtml, jobId, replyToMessageId],
  );

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
      // Disarm autosave until the opened content has settled (see the baseline
      // reset in the fetch below).
      armedRef.current = false;
      setSubject(defaultSubject);
      setUploadedFiles(defaultAttachments);
      setDraftId(initialDraftId || null);

      const parseRecipients = (raw: string): Recipient[] =>
        raw
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
          .map((email) => ({ email, name: "" }));

      // Set To recipients
      const toList = defaultTo ? parseRecipients(defaultTo) : [];
      setToRecipients(toList);

      setShowContactPicker(false);

      // Set CC recipients (for Reply All) — reveal the Cc row only when there's
      // something to show.
      const ccList = defaultCc ? parseRecipients(defaultCc) : [];
      setCcRecipients(ccList);
      setShowCc(!!defaultCc);

      // Set BCC recipients (for draft resume) — reveal the Bcc row only when
      // there's something to show.
      const bccList = defaultBcc ? parseRecipients(defaultBcc) : [];
      setBccRecipients(bccList);
      setShowBcc(!!defaultBcc);

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
          const initialBody = buildInitialBody(defaultAcc, defaultBody, sigs);
          setSelectedAccountId(defaultAcc.id);
          setBodyHtml(initialBody);
          setEditorKey((k) => k + 1);

          // Baseline the autosave scheduler to the just-opened content so the
          // opened state (including any auto-inserted signature, and a resumed
          // draft's id) is never treated as a user edit. Only edits past this
          // baseline mark the draft dirty and schedule a save.
          schedulerRef.current?.reset(
            {
              accountId: defaultAcc.id,
              to: toList.map((r) => r.email).join(", "),
              cc: ccList.length > 0 ? ccList.map((r) => r.email).join(", ") : undefined,
              bcc: bccList.length > 0 ? bccList.map((r) => r.email).join(", ") : undefined,
              subject: defaultSubject,
              bodyText: htmlToText(initialBody),
              bodyHtml: initialBody,
              jobId: jobId || undefined,
              replyToMessageId,
            },
            initialDraftId || null,
          );
          armedRef.current = true;
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTo, defaultCc, defaultBcc, defaultSubject, defaultBody, defaultAccountId, initialDraftId]);

  // Feed every settled compose snapshot into the scheduler. Inert until the
  // baseline is armed (above), then each edit schedules a debounced save.
  useEffect(() => {
    if (!open || !armedRef.current) return;
    schedulerRef.current?.notifyChange(buildSnapshot());
  }, [open, buildSnapshot]);

  // On close, flush any pending edit so the last change is kept as a draft
  // (issue #641: closing the compose window keeps the draft). Send takes a
  // different path — it cancels first (below) so this never recreates a draft
  // for an already-sent message.
  useEffect(() => {
    if (open) return;
    if (armedRef.current) {
      void schedulerRef.current?.flush();
      armedRef.current = false;
    }
  }, [open]);

  // Belt-and-suspenders: if the component unmounts while still armed (parent
  // tears it down without toggling `open`), flush the pending edit too.
  useEffect(() => {
    const scheduler = schedulerRef.current;
    return () => {
      if (armedRef.current) void scheduler?.flush();
    };
  }, []);

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
        // The message was sent and the server deletes the backing draft (it was
        // passed `draftId`). Cancel and disarm so the close handler below does
        // NOT flush a pending edit back into a new draft for a sent message.
        schedulerRef.current?.cancel();
        armedRef.current = false;
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
        <div className="flex-1 min-h-0 overflow-y-auto bg-white">
          {/* Header fields — inline rows separated by hairlines, Outlook-style */}
          <div className="px-4">
            {/* From */}
            <div className="flex items-center gap-3 border-b border-gray-200 py-2">
              <span className="w-14 shrink-0 text-sm text-[#666]">From</span>
              {accounts.length === 0 ? (
                <p className="flex-1 text-sm text-red-600">
                  No email accounts configured.{" "}
                  <a href="/settings/email" className="underline font-medium">
                    Add one in Settings.
                  </a>
                </p>
              ) : (
                <select
                  aria-label="From account"
                  value={selectedAccountId}
                  onChange={(e) => handleAccountChange(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-sm text-[#333] outline-none cursor-pointer"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.display_name || acc.label} &lt;{acc.email_address}&gt;
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* To — chips + type-ahead, with Cc/Bcc reveals and a contact picker */}
            <div className="relative flex items-start gap-3 border-b border-gray-200 py-2">
              <span className="w-14 shrink-0 pt-1 text-sm text-[#666]">To</span>
              <EmailAddressInput
                ref={toRef}
                variant="inline"
                label="To"
                recipients={toRecipients}
                onChange={setToRecipients}
                placeholder="Type name or email..."
              />
              <div className="flex shrink-0 items-center gap-1 pt-0.5">
                {!showCc && (
                  <button
                    type="button"
                    onClick={() => setShowCc(true)}
                    className="rounded px-1.5 py-0.5 text-xs font-medium text-[#666] hover:bg-gray-100 hover:text-[#2B5EA7]"
                  >
                    Cc
                  </button>
                )}
                {!showBcc && (
                  <button
                    type="button"
                    onClick={() => setShowBcc(true)}
                    className="rounded px-1.5 py-0.5 text-xs font-medium text-[#666] hover:bg-gray-100 hover:text-[#2B5EA7]"
                  >
                    Bcc
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Browse contacts"
                  onClick={() => setShowContactPicker((v) => !v)}
                  className="rounded p-1 text-[#666] hover:bg-gray-100 hover:text-[#2B5EA7]"
                >
                  <Users size={16} />
                </button>
              </div>

              {showContactPicker && (
                <div className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                  <ContactPicker
                    addedRecipients={toRecipients}
                    onSelect={(r) => {
                      setToRecipients([...toRecipients, r]);
                      setShowContactPicker(false);
                    }}
                    onClose={() => setShowContactPicker(false)}
                  />
                </div>
              )}
            </div>

            {/* Cc */}
            {showCc && (
              <div className="flex items-start gap-3 border-b border-gray-200 py-2">
                <span className="w-14 shrink-0 pt-1 text-sm text-[#666]">Cc</span>
                <EmailAddressInput
                  ref={ccRef}
                  variant="inline"
                  label="Cc"
                  recipients={ccRecipients}
                  onChange={setCcRecipients}
                  placeholder="Add Cc recipients..."
                />
              </div>
            )}

            {/* Bcc */}
            {showBcc && (
              <div className="flex items-start gap-3 border-b border-gray-200 py-2">
                <span className="w-14 shrink-0 pt-1 text-sm text-[#666]">Bcc</span>
                <EmailAddressInput
                  ref={bccRef}
                  variant="inline"
                  label="Bcc"
                  recipients={bccRecipients}
                  onChange={setBccRecipients}
                  placeholder="Add Bcc recipients..."
                />
              </div>
            )}

            {/* Subject — borderless inline field, placeholder only */}
            <div className="flex items-center gap-3 border-b border-gray-200 py-2">
              <span className="w-14 shrink-0 text-sm text-[#666]">Subject</span>
              <input
                required
                type="text"
                aria-label="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Add a subject"
                className="flex-1 min-w-0 bg-transparent text-sm text-[#333] outline-none placeholder:text-[#999]"
              />
            </div>
          </div>

          {/* White message canvas */}
          <div className="px-4 py-4">
            <TiptapEditor
              key={editorKey}
              content={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Type your message..."
              hideToolbar
              extraExtensions={richExtensions}
              onReady={setEditor}
            />
          </div>

          {/* Attachments */}
          <div className="px-4 pb-3">
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

            {/* Signature preview */}
            {selectedAccount?.signature && (
              <p className="text-xs text-[#999]">
                Signature from &quot;{selectedAccount.label}&quot; will be included.
              </p>
            )}
          </div>
        </div>

        {/* Bottom formatting toolbar (issue #642) — below the body, above send */}
        <ComposeFormattingToolbar
          editor={editor}
          visible={toolbarVisible}
          onToggleVisible={() => setToolbarVisible((v) => !v)}
        />

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
            onClick={() => onOpenChange(false)}
            className="px-5 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-[#666666] hover:bg-gray-50"
          >
            Cancel
          </button>

          {/* Autosave status — drafts now save automatically (issue #641); the
              manual "Save Draft" button is gone. */}
          <div
            className="ml-auto flex items-center gap-1.5 text-xs text-[#999]"
            aria-live="polite"
          >
            {autosaveStatus === "saving" && (
              <>
                <Loader2 size={12} className="animate-spin" />
                <span>Saving…</span>
              </>
            )}
            {autosaveStatus === "saved" && (
              <>
                <Check size={12} className="text-green-600" />
                <span>Saved</span>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
