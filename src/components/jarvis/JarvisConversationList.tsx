"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, MessageSquare, FlaskConical, Trash2 } from "lucide-react";
import type { JarvisConversation } from "@/lib/types";

interface JarvisConversationListProps {
  conversations: JarvisConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
}

function formatRelativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric" });
}

function getLastMessagePreview(conversation: JarvisConversation): string {
  const msgs = conversation.messages;
  if (!msgs || msgs.length === 0) return "No messages yet";
  const last = msgs[msgs.length - 1];
  const text = last.content;
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

export default function JarvisConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: JarvisConversationListProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirmingId) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(`[data-confirm-id="${confirmingId}"]`)) {
        setConfirmingId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [confirmingId]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border/50">
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all"
        >
          <Plus size={16} />
          New Conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="text-xs text-muted-foreground/60 text-center py-8 px-4">
            No conversations yet. Start a new one!
          </p>
        )}
        {conversations.map((conv) => {
          const isActive = conv.id === activeId;
          const isConfirming = confirmingId === conv.id;
          const title = conv.title || "New conversation";
          const preview = getLastMessagePreview(conv);
          const time = formatRelativeDate(conv.updated_at);

          return (
            <div
              key={conv.id}
              className={`group w-full text-left border-b border-border/50 hover:bg-accent transition-colors ${
                isActive ? "bg-primary/10 border-l-2 border-primary" : ""
              }`}
            >
              <div className="flex items-start gap-2.5 px-3 py-3">
                <button
                  onClick={() => onSelect(conv.id)}
                  className="flex items-start gap-2.5 flex-1 min-w-0 text-left"
                >
                  {conv.context_type === "rnd" ? (
                    <FlaskConical size={16} className="text-violet-400/60 flex-shrink-0 mt-0.5" />
                  ) : (
                    <MessageSquare size={16} className="text-muted-foreground/60 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{title}</p>
                      <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">{time}</span>
                    </div>
                    <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{preview}</p>
                  </div>
                </button>
                {onDelete && !isConfirming && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmingId(conv.id);
                    }}
                    className="p-1 rounded-md text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 mt-0.5"
                    title="Delete conversation"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {isConfirming && (
                <div data-confirm-id={conv.id} className="flex items-center justify-between px-3 pb-2.5 -mt-1">
                  <p className="text-xs text-destructive">Really bruv?</p>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setConfirmingId(null)}
                      className="px-2 py-0.5 rounded text-xs text-muted-foreground hover:bg-accent transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setConfirmingId(null);
                        onDelete!(conv.id);
                      }}
                      className="px-2 py-0.5 rounded text-xs text-white bg-destructive hover:bg-destructive/80 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
