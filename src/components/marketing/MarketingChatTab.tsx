"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { JarvisConversation } from "@/lib/types";
import JarvisChat from "@/components/jarvis/JarvisChat";
import JarvisConversationList from "@/components/jarvis/JarvisConversationList";
import { PanelRightClose, PanelRight } from "lucide-react";
import { toast } from "sonner";

export default function MarketingChatTab() {
  const { user, profile } = useAuth();
  const [conversations, setConversations] = useState<JarvisConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);

  const isAdmin = profile?.role === "admin";

  const fetchConversations = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();

    let query = supabase
      .from("jarvis_conversations")
      .select("*")
      .eq("context_type", "marketing")
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
    setActiveConversationId(id);
  }

  function handleConversationCreated(id: string) {
    setActiveConversationId(id);
    fetchConversations();
  }

  async function handleDeleteConversation(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("jarvis_conversations")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete conversation.");
    } else {
      toast.success("Conversation deleted.");
      if (activeConversationId === id) {
        setActiveConversationId(null);
      }
      fetchConversations();
    }
  }

  return (
    <div className="flex h-full">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
          <button
            onClick={handleNewConversation}
            className="lg:hidden text-sm text-accent-text font-medium"
          >
            New Chat
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden lg:flex items-center justify-center w-8 h-8 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
          >
            {sidebarOpen ? <PanelRightClose size={18} /> : <PanelRight size={18} />}
          </button>
        </div>

        {/* Chat */}
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground/60">Loading...</p>
            </div>
          ) : (
            <JarvisChat
              key={activeConversationId || "new"}
              contextType="marketing"
              conversationId={activeConversationId}
              onConversationCreated={handleConversationCreated}
              directDepartment="marketing"
            />
          )}
        </div>
      </div>

      {/* Conversation sidebar */}
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
