"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent,
  type DragEvent,
} from "react";
import { ArrowUp, Paperclip, X, Loader2, RotateCw, FileText } from "lucide-react";
import type { JarvisAttachment } from "@/lib/types";
import {
  admitAttachments,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/jarvis/attachments/selection";

// Accepted attachment types — images and PDF (#198, #199, #200).
const ACCEPTED_ATTACHMENT_TYPES = "image/*,application/pdf";

interface JarvisInputProps {
  onSend: (message: string, attachments: JarvisAttachment[]) => void;
  // Uploads a picked file and resolves to the stored attachment reference.
  // Absent for surfaces (e.g. department modes) that don't take attachments.
  onUploadAttachment?: (file: File) => Promise<JarvisAttachment>;
  disabled?: boolean;
  placeholder?: string;
  fillValue?: string;
  onFillConsumed?: () => void;
}

// One picked file as it moves from local preview to a stored attachment.
// A message can hold up to MAX_ATTACHMENTS_PER_MESSAGE of these (#200).
interface AttachmentSlot {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "done" | "error";
  result?: JarvisAttachment;
  error?: string;
}

const GENERIC_UPLOAD_ERROR =
  "Upload failed — check your connection and try again.";

function isAcceptedFile(file: File): boolean {
  return file.type.startsWith("image/") || file.type === "application/pdf";
}

export default function JarvisInput({
  onSend,
  onUploadAttachment,
  disabled,
  placeholder,
  fillValue,
  onFillConsumed,
}: JarvisInputProps) {
  const [value, setValue] = useState("");
  const [slots, setSlots] = useState<AttachmentSlot[]>([]);
  // Cap / unsupported-type message — distinct from a slot's own upload error.
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canAttach = !!onUploadAttachment;

  // Handle fill from quick action buttons
  useEffect(() => {
    if (fillValue) {
      setValue(fillValue);
      onFillConsumed?.();
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = fillValue.length;
        }
      });
    }
  }, [fillValue, onFillConsumed]);

  // Kept current so the unmount cleanup below sees the latest slots.
  const slotsRef = useRef<AttachmentSlot[]>([]);
  slotsRef.current = slots;

  // Revoke every object URL when the input unmounts so previews don't leak.
  useEffect(() => {
    return () => {
      for (const slot of slotsRef.current) URL.revokeObjectURL(slot.previewUrl);
    };
  }, []);

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxHeight = 6 * 24; // ~6 lines
    ta.style.height = Math.min(ta.scrollHeight, maxHeight) + "px";
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    adjustHeight();
  }

  // Upload one slot's file, moving it uploading → done | error.
  const runUpload = useCallback(
    async (id: string, file: File) => {
      if (!onUploadAttachment) return;
      setSlots((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: "uploading", error: undefined } : s,
        ),
      );
      try {
        const result = await onUploadAttachment(file);
        setSlots((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, status: "done", result } : s,
          ),
        );
      } catch (err) {
        setSlots((prev) =>
          prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  status: "error",
                  error: (err as Error).message || GENERIC_UPLOAD_ERROR,
                }
              : s,
          ),
        );
      }
    },
    [onUploadAttachment],
  );

  // Take freshly picked / dropped files: gate them by type, cap the total
  // at five, surface a clear message for anything turned away, and start
  // an upload for each one admitted.
  const addFiles = useCallback(
    (incoming: File[]) => {
      if (!onUploadAttachment || disabled || incoming.length === 0) return;

      // Client-side type gate — mirrors the server's image-and-PDF rule.
      const supported = incoming.filter(isAcceptedFile);
      const hadUnsupported = supported.length < incoming.length;

      const { accepted, rejected } = admitAttachments(slots.length, supported);

      const messages: string[] = [];
      if (hadUnsupported) {
        messages.push("Only images and PDFs can be attached.");
      }
      if (rejected.length > 0) {
        messages.push(
          `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`,
        );
      }
      setSelectionError(messages.join(" ") || null);

      if (accepted.length === 0) return;

      const fresh: AttachmentSlot[] = accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
      }));
      setSlots((prev) => [...prev, ...fresh]);
      for (const slot of fresh) runUpload(slot.id, slot.file);
    },
    [onUploadAttachment, disabled, slots.length, runUpload],
  );

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Reset so picking the same file again still fires a change event.
    e.target.value = "";
    addFiles(files);
  }

  function removeSlot(id: string) {
    setSlots((prev) => {
      const slot = prev.find((s) => s.id === id);
      if (slot) URL.revokeObjectURL(slot.previewUrl);
      return prev.filter((s) => s.id !== id);
    });
    setSelectionError(null);
  }

  function clearSlots() {
    for (const slot of slots) URL.revokeObjectURL(slot.previewUrl);
    setSlots([]);
    setSelectionError(null);
  }

  // Desktop drag-and-drop — drop image/PDF files anywhere on the chat box
  // to attach them, matching the Job Files drag-and-drop behavior.
  function handleDragOver(e: DragEvent) {
    if (!canAttach || disabled) return;
    e.preventDefault();
    setIsDragging(true);
  }
  function handleDragLeave(e: DragEvent) {
    if (!canAttach || disabled) return;
    e.preventDefault();
    if (e.currentTarget === e.target) setIsDragging(false);
  }
  function handleDrop(e: DragEvent) {
    if (!canAttach || disabled) return;
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) addFiles(files);
  }

  const doneSlots = slots.filter((s) => s.status === "done");
  // A pending slot is either still uploading or sitting in an error state;
  // either way the message isn't ready to send until it's resolved/removed.
  const hasPendingSlot = slots.some((s) => s.status !== "done");
  const isEmpty = value.trim().length === 0;

  function handleSend() {
    const trimmed = value.trim();
    // A message may carry just attachments with no text — but never send
    // while an upload is in flight or a file is sitting in an error state.
    if (disabled || hasPendingSlot) return;
    if (!trimmed && doneSlots.length === 0) return;

    onSend(
      trimmed,
      doneSlots.map((s) => s.result!),
    );
    setValue("");
    clearSlots();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const sendDisabled =
    disabled || hasPendingSlot || (isEmpty && doneSlots.length === 0);
  const attachDisabled =
    disabled || slots.length >= MAX_ATTACHMENTS_PER_MESSAGE;

  return (
    <div
      className="px-4 pb-4 pt-2"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Attachment strip — one tile per picked file (image thumbnail or
          PDF chip), each with its own upload / error state. */}
      {(slots.length > 0 || selectionError) && (
        <div className="mb-2 space-y-1.5">
          {slots.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {slots.map((slot) => {
                const isPdf = slot.file.type === "application/pdf";
                const errored = slot.status === "error";
                return (
                  <div key={slot.id} className="relative">
                    {isPdf ? (
                      <div
                        className={`flex h-16 w-32 flex-col items-center justify-center gap-1 rounded-lg border px-2 ${
                          errored ? "border-destructive" : "border-border"
                        } bg-muted`}
                      >
                        <FileText
                          size={18}
                          className="flex-shrink-0 text-muted-foreground"
                        />
                        <span className="max-w-full truncate text-[10px] text-foreground">
                          {slot.file.name}
                        </span>
                      </div>
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={slot.previewUrl}
                        alt={slot.file.name}
                        className={`h-16 w-16 rounded-lg border object-cover ${
                          errored ? "border-destructive" : "border-border"
                        }`}
                      />
                    )}
                    {slot.status === "uploading" && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                        <Loader2
                          size={18}
                          className="animate-spin text-white"
                        />
                      </div>
                    )}
                    {errored && (
                      <button
                        type="button"
                        onClick={() => runUpload(slot.id, slot.file)}
                        aria-label="Retry upload"
                        className="absolute inset-0 flex items-center justify-center rounded-lg bg-destructive/50 text-white"
                      >
                        <RotateCw size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeSlot(slot.id)}
                      aria-label="Remove attachment"
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shadow"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {selectionError && (
            <p className="text-xs text-destructive">{selectionError}</p>
          )}
        </div>
      )}

      <div
        className={`flex items-end gap-2 rounded-2xl border bg-card px-4 py-2 transition-all focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/10 ${
          isDragging ? "border-primary ring-2 ring-primary/20" : "border-border"
        }`}
      >
        {canAttach && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_ATTACHMENT_TYPES}
              multiple
              onChange={handleFilePicked}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={attachDisabled}
              aria-label="Attach images or PDFs"
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-muted-foreground transition-all hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Paperclip size={16} />
            </button>
          </>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={
            disabled
              ? "Jarvis is thinking..."
              : placeholder || "Message Jarvis..."
          }
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50 py-1"
        />
        <button
          onClick={handleSend}
          disabled={sendDisabled}
          aria-label="Send message"
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md"
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
