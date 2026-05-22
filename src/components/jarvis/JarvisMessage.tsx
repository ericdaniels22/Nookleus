"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { FileText } from "lucide-react";
import type {
  JarvisAttachment,
  JarvisMessage as JarvisMessageType,
} from "@/lib/types";

// Renders an image attachment inside a message bubble (#198). The bytes
// live in a private bucket, so a short-lived signed URL is fetched on
// mount. Clicking the thumbnail opens the image at full size.
function JarvisAttachmentImage({
  attachment,
}: {
  attachment: JarvisAttachment;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/jarvis/attachments?path=${encodeURIComponent(attachment.storage_path)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.url) setUrl(data.url);
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment.storage_path]);

  if (failed) {
    return (
      <div className="rounded-xl bg-white/10 px-3 py-2 text-xs text-white/70">
        Image unavailable
      </div>
    );
  }
  if (!url) {
    return (
      <div className="h-40 w-40 animate-pulse rounded-xl bg-white/10" />
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={attachment.filename || "Attached image"}
        className="max-h-60 max-w-full rounded-xl object-cover"
      />
    </a>
  );
}

// Renders a PDF attachment inside a message bubble as a labelled chip
// (#199). A short-lived signed URL is fetched on mount so the chip opens
// the PDF in a new tab; if the fetch fails the chip is still shown, just
// not linked.
function JarvisAttachmentPdf({
  attachment,
}: {
  attachment: JarvisAttachment;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/jarvis/attachments?path=${encodeURIComponent(attachment.storage_path)}`,
        );
        const data = await res.json();
        if (!cancelled && res.ok && data.url) setUrl(data.url);
      } catch {
        // Leave the chip unlinked — the filename is still informative.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment.storage_path]);

  const label = attachment.filename || "PDF document";
  const chip = (
    <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
      <FileText size={16} className="flex-shrink-0 text-white/80" />
      <span className="max-w-[200px] truncate text-xs text-white">
        {label}
      </span>
    </div>
  );

  if (!url) return chip;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {chip}
    </a>
  );
}

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) {
    return `Yesterday at ${new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function JarvisMessage({ message }: { message: JarvisMessageType }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-start gap-3 px-4 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-[image:var(--gradient-primary)] text-white flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-white">J</span>
        </div>
      )}
      <div className={`max-w-[80%] space-y-1 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={
            isUser
              ? "bg-[image:var(--gradient-secondary)] text-white rounded-2xl rounded-tr-sm px-4 py-2.5"
              : "bg-muted text-foreground rounded-2xl rounded-tl-sm px-4 py-2.5"
          }
        >
          {isUser ? (
            <div className="space-y-2">
              {message.attachment?.kind === "image" && (
                <JarvisAttachmentImage attachment={message.attachment} />
              )}
              {message.attachment?.kind === "pdf" && (
                <JarvisAttachmentPdf attachment={message.attachment} />
              )}
              {message.content && (
                <p className="text-sm whitespace-pre-wrap">
                  {message.content}
                </p>
              )}
            </div>
          ) : (
            <div className="text-sm jarvis-markdown">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  ul: ({ children }) => <ul className="list-disc ml-4 mb-2 space-y-1">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal ml-4 mb-2 space-y-1">{children}</ol>,
                  li: ({ children }) => <li>{children}</li>,
                  code: ({ children, className }) => {
                    const isBlock = className?.includes("language-");
                    if (isBlock) {
                      return (
                        <pre className="bg-muted rounded-lg p-3 my-2 overflow-x-auto">
                          <code className="text-xs font-mono">{children}</code>
                        </pre>
                      );
                    }
                    return (
                      <code className="bg-muted rounded px-1.5 py-0.5 text-xs font-mono">
                        {children}
                      </code>
                    );
                  },
                  a: ({ href, children }) => (
                    <a href={href} className="text-primary underline" target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
        <p className={`text-[10px] text-muted-foreground/60 px-1 ${isUser ? "text-right" : "text-left"}`}>
          {formatRelativeTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
