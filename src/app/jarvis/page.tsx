"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { JarvisConversation } from "@/lib/types";
import JarvisChat from "@/components/jarvis/JarvisChat";
import JarvisConversationList from "@/components/jarvis/JarvisConversationList";
import { Sparkles, FlaskConical, Megaphone, HardHat, PanelRightClose, PanelRight } from "lucide-react";
import { toast } from "sonner";

type JarvisMode = "jarvis" | "rnd" | "marketing" | "field-ops";

export default function JarvisPage() {
  const { user, profile } = useAuth();
  const [conversations, setConversations] = useState<JarvisConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<JarvisMode>("jarvis");

  const isAdmin = profile?.role === "admin";

  const fetchConversations = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();

    // Fetch general, rnd, marketing, and field-ops conversations
    let query = supabase
      .from("jarvis_conversations")
      .select("*")
      .in("context_type", ["general", "rnd", "marketing", "field-ops"])
      .order("updated_at", { ascending: false });

    if (!isAdmin) {
      query = query.eq("user_id", user.id);
    }

    const { data } = await query;
    if (data) {
      setConversations(data as JarvisConversation[]);
    }
    setLoading(false);
  }, [user, isAdmin]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  function handleNewConversation() {
    setActiveConversationId(null);
  }

  function handleSelectConversation(id: string) {
    // When selecting a conversation, switch mode to match its context_type
    const conv = conversations.find((c) => c.id === id);
    if (conv?.context_type === "rnd") {
      setMode("rnd");
    } else if (conv?.context_type === "marketing") {
      setMode("marketing");
    } else if (conv?.context_type === "field-ops") {
      setMode("field-ops");
    } else {
      setMode("jarvis");
    }
    setActiveConversationId(id);
  }

  function handleConversationCreated(id: string) {
    setActiveConversationId(id);
    fetchConversations();
  }

  async function handleDeleteConversation(id: string) {
    // Routed server-side (#198): the conversation's image attachments must
    // be swept from the `jarvis-attachments` bucket before the row goes,
    // and that needs the Service client a browser session does not have.
    let ok = false;
    try {
      const res = await fetch(`/api/jarvis/conversations/${id}`, {
        method: "DELETE",
      });
      ok = res.ok;
    } catch {
      ok = false;
    }

    if (!ok) {
      toast.error("Failed to delete conversation.");
    } else {
      toast.success("Conversation deleted.");
      if (activeConversationId === id) {
        setActiveConversationId(null);
      }
      fetchConversations();
    }
  }

  function handleModeToggle(newMode: JarvisMode) {
    setMode(newMode);
    setActiveConversationId(null); // Start fresh when switching modes
  }

  const isRnd = mode === "rnd";
  const isMarketing = mode === "marketing";
  const isFieldOps = mode === "field-ops";

  return (
    <div className="h-[calc(100dvh-3.5rem)] lg:h-dvh flex -m-6 lg:-m-8">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isRnd ? "border-violet-500/20" : isMarketing ? "border-teal-500/20" : isFieldOps ? "border-orange-500/20" : "border-border"}`}>
          <div className="flex items-center gap-2">
            {isRnd ? (
              <FlaskConical size={20} className="text-violet-400" />
            ) : isMarketing ? (
              <Megaphone size={20} className="text-teal-400" />
            ) : isFieldOps ? (
              <HardHat size={20} className="text-orange-400" />
            ) : (
              <Sparkles size={20} className="text-primary" />
            )}
            <h1 className="text-lg font-semibold text-foreground">
              Jarvis
              {isRnd && (
                <span className="text-violet-400 font-normal"> &gt; R&D</span>
              )}
              {isMarketing && (
                <span className="text-teal-400 font-normal"> &gt; Marketing</span>
              )}
              {isFieldOps && (
                <span className="text-orange-400 font-normal"> &gt; Field Ops</span>
              )}
            </h1>
            <span className={`w-2 h-2 rounded-full ${isRnd ? "bg-violet-400" : isMarketing ? "bg-teal-400" : isFieldOps ? "bg-orange-400" : "bg-emerald-500"}`} title="Connected" />
          </div>

          <div className="flex items-center gap-2">
            {/* Mode toggle — admin only */}
            {isAdmin && (
              <div className="flex items-center bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => handleModeToggle("jarvis")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    mode === "jarvis"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sparkles size={12} />
                  Jarvis
                </button>
                <button
                  onClick={() => handleModeToggle("rnd")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    isRnd
                      ? "bg-violet-500/20 text-violet-300 shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FlaskConical size={12} />
                  R&D
                </button>
                <button
                  onClick={() => handleModeToggle("marketing")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    isMarketing
                      ? "bg-teal-500/20 text-teal-300 shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Megaphone size={12} />
                  Marketing
                </button>
                <button
                  onClick={() => handleModeToggle("field-ops")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    isFieldOps
                      ? "bg-orange-500/20 text-orange-300 shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <HardHat size={12} />
                  Field Ops
                </button>
              </div>
            )}

            {/* Mobile: new conversation button */}
            <button
              onClick={handleNewConversation}
              className="lg:hidden text-sm text-primary font-medium"
            >
              New Chat
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden lg:flex items-center justify-center w-8 h-8 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
            >
              {sidebarOpen ? <PanelRightClose size={18} /> : <PanelRight size={18} />}
            </button>
          </div>
        </div>

        {/* Chat */}
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground/60">Loading...</p>
            </div>
          ) : (
            <JarvisChat
              key={`${mode}-${activeConversationId || "new"}`}
              contextType={isRnd ? "rnd" : isMarketing ? "marketing" : isFieldOps ? "field-ops" : "general"}
              conversationId={activeConversationId}
              onConversationCreated={handleConversationCreated}
              directDepartment={isRnd ? "rnd" : isMarketing ? "marketing" : isFieldOps ? "field-ops" : undefined}
            />
          )}
        </div>
      </div>

      {/* Conversation sidebar — right side */}
      <div
        className={`bg-card border-l border-border flex-shrink-0 transition-all duration-200 ${
          sidebarOpen ? "w-72" : "w-0"
        } overflow-hidden hidden lg:block`}
      >
        <JarvisConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={handleSelectConversation}
          onNew={handleNewConversation}
          onDelete={handleDeleteConversation}
        />
      </div>
    </div>
  );
}
