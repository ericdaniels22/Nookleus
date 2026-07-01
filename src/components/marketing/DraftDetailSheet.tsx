"use client";

import { useState, useRef, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Copy,
  Check,
  Trash2,
  ExternalLink,
  ImageIcon,
  X as XIcon,
} from "lucide-react";
import type { MarketingDraft } from "@/lib/types";

const PLATFORM_LIMITS: Record<string, { max: number; optimal: number }> = {
  instagram: { max: 2200, optimal: 150 },
  facebook: { max: 63206, optimal: 250 },
  linkedin: { max: 3000, optimal: 150 },
  gbp: { max: 1500, optimal: 300 },
};

const platformClasses: Record<MarketingDraft["platform"], string> = {
  instagram:
    "bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0",
  facebook: "bg-blue-600 text-white border-0",
  linkedin: "bg-blue-800 text-white border-0",
  gbp: "bg-primary text-primary-foreground border-0",
};

interface DraftDetailSheetProps {
  draft: MarketingDraft | null;
  onClose: () => void;
  onUpdate: (draft: MarketingDraft) => void;
  onDelete: (id: string) => void;
  onPickImage: () => void;
}

export default function DraftDetailSheet({
  draft,
  onClose,
  onUpdate,
  onDelete,
  onPickImage,
}: DraftDetailSheetProps) {
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [status, setStatus] = useState<MarketingDraft["status"]>("draft");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  // Sync local state when draft changes
  useEffect(() => {
    if (draft) {
      setCaption(draft.caption);
      setHashtags(draft.hashtags ?? "");
      setStatus(draft.status);
    }
  }, [draft]);

  // Auto-expand textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [caption]);

  if (!draft) return null;

  const limits = PLATFORM_LIMITS[draft.platform];
  const charCount = caption.length;
  const charColor =
    charCount > limits.max
      ? "text-red-500"
      : charCount > limits.optimal
        ? "text-yellow-500"
        : "text-green-500";

  const platformLabel =
    draft.platform === "gbp"
      ? "GBP"
      : draft.platform.charAt(0).toUpperCase() + draft.platform.slice(1);

  async function patchDraft(fields: Partial<MarketingDraft>) {
    if (!draft) return;
    try {
      const res = await fetch("/api/marketing/drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id, ...fields }),
      });
      if (!res.ok) throw new Error("Failed to update draft");
      const data = await res.json();
      onUpdate(data.draft);
      return data.draft;
    } catch {
      toast.error("Failed to save changes");
    }
  }

  function handleCaptionBlur() {
    if (caption !== draft?.caption) {
      patchDraft({ caption });
    }
  }

  function handleHashtagsBlur() {
    if (hashtags !== (draft?.hashtags ?? "")) {
      patchDraft({ hashtags: hashtags || null });
    }
  }

  async function handleStatusChange(newStatus: MarketingDraft["status"]) {
    setStatus(newStatus);
    await patchDraft({ status: newStatus });
  }

  async function handleCopyCaption() {
    const text = hashtags ? `${caption}\n\n${hashtags}` : caption;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Caption copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleMarkAsPosted() {
    setStatus("posted");
    await patchDraft({ status: "posted", posted_at: new Date().toISOString() });
    toast.success("Draft marked as posted");
  }

  async function handleDelete() {
    if (!draft) return;
    const ok = window.confirm(
      "Are you sure you want to delete this draft? This cannot be undone."
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/marketing/drafts?id=${draft.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete draft");
      toast.success("Draft deleted");
      onDelete(draft.id);
      onClose();
    } catch {
      toast.error("Failed to delete draft");
    }
  }

  async function handleRemoveImage() {
    await patchDraft({ image_id: null });
  }

  const imageUrl =
    draft.image && supabaseUrl
      ? `${supabaseUrl}/storage/v1/object/public/marketing-assets/${draft.image.storage_path}`
      : null;

  return (
    <Sheet
      open={!!draft}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="overflow-y-auto w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit Draft</SheetTitle>
          <SheetDescription>
            Update the caption, hashtags, and image for this post.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6">
          {/* Platform badge + Status select */}
          <div className="flex items-center gap-3">
            <Badge className={platformClasses[draft.platform]}>
              {platformLabel}
            </Badge>
            <select
              value={status}
              onChange={(e) =>
                handleStatusChange(
                  e.target.value as MarketingDraft["status"]
                )
              }
              className="rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="draft">Draft</option>
              <option value="ready">Ready</option>
              <option value="posted">Posted</option>
            </select>
          </div>

          {/* Caption textarea */}
          <div>
            <label className="mb-1 block text-sm font-medium">Caption</label>
            <textarea
              ref={textareaRef}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onBlur={handleCaptionBlur}
              rows={3}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className={`mt-1 text-xs ${charColor}`}>
              {charCount} / {limits.max}
            </p>
          </div>

          {/* Hashtags input */}
          <div>
            <label className="mb-1 block text-sm font-medium">Hashtags</label>
            <input
              type="text"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              onBlur={handleHashtagsBlur}
              placeholder="#hashtag1 #hashtag2"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Image section */}
          <div>
            <label className="mb-1 block text-sm font-medium">Image</label>
            {imageUrl ? (
              <div className="space-y-2">
                <img
                  src={imageUrl}
                  alt=""
                  className="h-48 w-full rounded-lg object-cover"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onPickImage}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                  >
                    <ImageIcon className="h-4 w-4" />
                    Change Image
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <XIcon className="h-4 w-4" />
                    Remove Image
                  </button>
                </div>
              </div>
            ) : draft.image_brief ? (
              <div className="space-y-2">
                <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Image brief:</p>
                  <p className="mt-1">{draft.image_brief}</p>
                </div>
                <button
                  type="button"
                  onClick={onPickImage}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                >
                  <ImageIcon className="h-4 w-4" />
                  Pick Image
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onPickImage}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <ImageIcon className="h-4 w-4" />
                Pick Image
              </button>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <button
              type="button"
              onClick={handleCopyCaption}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted transition-colors"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copy Caption
            </button>
            <button
              type="button"
              onClick={handleMarkAsPosted}
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-sm text-white hover:bg-teal-700 transition-colors"
            >
              <Check className="h-4 w-4" />
              Mark as Posted
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>

          {/* Conversation link */}
          {draft.conversation_id && (
            <a
              href="/jarvis"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              View conversation
            </a>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
