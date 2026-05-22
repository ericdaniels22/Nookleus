"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Paperclip, X, Loader2, FileText } from "lucide-react";
import type { JarvisAttachment } from "@/lib/types";

// Accepted attachment types — images and PDF (#198, #199).
const ACCEPTED_ATTACHMENT_TYPES = "image/*,application/pdf";

interface JarvisInputProps {
  onSend: (message: string, attachment?: JarvisAttachment) => void;
  // Uploads a picked file and resolves to the stored attachment reference.
  // Absent for surfaces (e.g. department modes) that don't take attachments.
  onUploadAttachment?: (file: File) => Promise<JarvisAttachment>;
  disabled?: boolean;
  placeholder?: string;
  fillValue?: string;
  onFillConsumed?: () => void;
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
  const [attachment, setAttachment] = useState<JarvisAttachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // A picked PDF has no image preview — it shows as a labelled chip (#199).
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Held so an upload failure can be retried with the same file.
  const pendingFileRef = useRef<File | null>(null);

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

  // Revoke the object URL when the preview changes or the input unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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

  const runUpload = useCallback(
    async (file: File) => {
      if (!onUploadAttachment) return;
      pendingFileRef.current = file;
      setUploadError(null);
      setUploading(true);
      try {
        const result = await onUploadAttachment(file);
        setAttachment(result);
      } catch (err) {
        setAttachment(null);
        setUploadError(
          (err as Error).message ||
            "Upload failed — check your connection and try again.",
        );
      } finally {
        setUploading(false);
      }
    },
    [onUploadAttachment],
  );

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires a change event.
    e.target.value = "";
    if (!file) return;

    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";
    if (!isImage && !isPdf) {
      setUploadError(
        "That isn't a supported file — attach an image (JPEG, PNG, GIF, WebP) or a PDF.",
      );
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (isPdf) {
      // A PDF gets a labelled chip, not an image thumbnail.
      setPreviewUrl(null);
      setPdfName(file.name || "PDF document");
    } else {
      setPdfName(null);
      setPreviewUrl(URL.createObjectURL(file));
    }
    runUpload(file);
  }

  function clearAttachment() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPdfName(null);
    setAttachment(null);
    setUploadError(null);
    setUploading(false);
    pendingFileRef.current = null;
  }

  function handleSend() {
    const trimmed = value.trim();
    // A message may carry just an image with no text — but never send
    // while an upload is still in flight.
    if (disabled || uploading) return;
    if (!trimmed && !attachment) return;

    onSend(trimmed, attachment ?? undefined);
    setValue("");
    clearAttachment();
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

  const isEmpty = value.trim().length === 0;
  const canAttach = !!onUploadAttachment;
  const sendDisabled = disabled || uploading || (isEmpty && !attachment);

  return (
    <div className="px-4 pb-4 pt-2">
      {/* Attachment preview / upload state */}
      {(previewUrl || pdfName || uploadError) && (
        <div className="mb-2 flex items-center gap-2">
          {previewUrl && (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Attachment preview"
                className="h-16 w-16 rounded-lg object-cover border border-border"
              />
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                  <Loader2 size={18} className="animate-spin text-white" />
                </div>
              )}
              {!uploading && (
                <button
                  type="button"
                  onClick={clearAttachment}
                  aria-label="Remove attachment"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shadow"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          {pdfName && (
            <div className="relative flex items-center gap-2 rounded-lg border border-border bg-muted py-2 pl-3 pr-8">
              <FileText
                size={16}
                className="flex-shrink-0 text-muted-foreground"
              />
              <span className="max-w-[160px] truncate text-xs text-foreground">
                {pdfName}
              </span>
              {uploading && (
                <Loader2
                  size={14}
                  className="animate-spin text-muted-foreground"
                />
              )}
              {!uploading && (
                <button
                  type="button"
                  onClick={clearAttachment}
                  aria-label="Remove attachment"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shadow"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          {uploadError && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <span>{uploadError}</span>
              {pendingFileRef.current && (
                <button
                  type="button"
                  onClick={() => {
                    const file = pendingFileRef.current;
                    if (file) runUpload(file);
                  }}
                  className="underline font-medium"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 bg-card border border-border rounded-2xl px-4 py-2 focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
        {canAttach && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_ATTACHMENT_TYPES}
              onChange={handleFilePicked}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || uploading}
              aria-label="Attach image or PDF"
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
