"use client";

import { useEffect, useState, useRef, useCallback, type MutableRefObject } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { resolveActiveOrgId } from "@/lib/supabase/resolve-active-org-id";
import type {
  JarvisAttachment,
  JarvisConversation,
  JarvisMessage as JarvisMessageType,
} from "@/lib/types";
import JarvisMessage from "./JarvisMessage";
import JarvisInput from "./JarvisInput";
import JarvisQuickActions from "./JarvisQuickActions";
import JarvisTypingIndicator from "./JarvisTypingIndicator";
import JarvisWelcome from "./JarvisWelcome";
import type { BrainState } from "./neural-network/useNetworkAnimation";

export interface JarvisChatProps {
  contextType: "general" | "job" | "rnd" | "marketing" | "field-ops";
  jobId?: string;
  jobContext?: {
    customerName: string;
    address: string;
    status: string;
    damageType: string;
  };
  conversationId?: string | null;
  onConversationCreated?: (id: string) => void;
  directDepartment?: "rnd" | "marketing" | "field-ops";
}

export default function JarvisChat({
  contextType,
  jobId,
  jobContext,
  conversationId,
  onConversationCreated,
  directDepartment,
}: JarvisChatProps) {
  const { user } = useAuth();
  const [conversation, setConversation] = useState<JarvisConversation | null>(null);
  const [messages, setMessages] = useState<JarvisMessageType[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [brainState, setBrainState] = useState<BrainState>({ mode: "idle" });
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const abortControllerRef: MutableRefObject<AbortController | null> = useRef(null);
  // The conversation id, generated client-side so an attachment can be
  // uploaded under {org}/{conversation_id}/ before the first message is
  // sent and the `jarvis_conversations` row exists (#198).
  const pendingConversationIdRef = useRef<string | null>(null);

  // The id this chat will use for its conversation: the loaded conversation's
  // id, or a freshly minted one held until the row is created.
  const ensureConversationId = useCallback((): string => {
    if (conversation) return conversation.id;
    if (!pendingConversationIdRef.current) {
      pendingConversationIdRef.current = crypto.randomUUID();
    }
    return pendingConversationIdRef.current;
  }, [conversation]);

  // Upload a picked image and resolve to its stored attachment reference.
  const handleUploadAttachment = useCallback(
    async (file: File): Promise<JarvisAttachment> => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("conversation_id", ensureConversationId());

      const res = await fetch("/api/jarvis/attachments", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.attachment) {
        throw new Error(
          data.error || "Upload failed — check your connection and try again.",
        );
      }
      return data.attachment as JarvisAttachment;
    },
    [ensureConversationId],
  );

  // Load conversation
  const loadConversation = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("jarvis_conversations")
      .select("*")
      .eq("id", id)
      .single();

    if (data) {
      const conv = data as JarvisConversation;
      setConversation(conv);
      setMessages(conv.messages || []);
    }
    setLoading(false);
  }, []);

  // For job context: find or await the active conversation for this job
  const loadJobConversation = useCallback(async () => {
    if (!jobId || !user) {
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("jarvis_conversations")
      .select("*")
      .eq("job_id", jobId)
      .eq("user_id", user.id)
      .eq("context_type", "job")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const conv = data as JarvisConversation;
      setConversation(conv);
      setMessages(conv.messages || []);
      onConversationCreated?.(conv.id);
    }
    setLoading(false);
  }, [jobId, user, onConversationCreated]);

  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
    } else if (contextType === "job") {
      loadJobConversation();
    } else {
      setLoading(false);
    }
  }, [conversationId, contextType, loadConversation, loadJobConversation]);

  // Auto-scroll
  useEffect(() => {
    if (!userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isTyping]);

  function handleScroll() {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    userScrolledUp.current = scrollHeight - scrollTop - clientHeight > 100;
  }

  async function createConversation(firstMessage: JarvisMessageType): Promise<JarvisConversation> {
    const supabase = createClient();
    const title = firstMessage.content.length > 50
      ? firstMessage.content.slice(0, 47) + "..."
      : firstMessage.content;

    // The tenant_isolation_jarvis_conversations RLS policy rejects an insert
    // without organization_id; resolve it from the session JWT claim.
    const { data: { session } } = await supabase.auth.getSession();
    const orgId = resolveActiveOrgId(session?.access_token);
    if (!orgId) {
      throw new Error("No active organization on session — cannot create conversation");
    }

    const { data, error } = await supabase
      .from("jarvis_conversations")
      .insert({
        // Client-generated so it matches the conversation prefix any
        // attachment was already uploaded under (#198).
        id: ensureConversationId(),
        user_id: user?.id,
        organization_id: orgId,
        job_id: jobId || null,
        context_type: contextType,
        title,
        messages: [firstMessage],
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return data as JarvisConversation;
  }

  async function saveMessages(convId: string, msgs: JarvisMessageType[]) {
    const supabase = createClient();
    await supabase
      .from("jarvis_conversations")
      .update({
        messages: msgs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", convId);
  }

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  async function handleSend(
    content: string,
    attachments?: JarvisAttachment[],
  ) {
    const userMsg: JarvisMessageType = {
      role: "user",
      content,
      timestamp: new Date().toISOString(),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsTyping(true);
    userScrolledUp.current = false;
    setBrainState({ mode: "firing" });
    setTimeout(() => setBrainState({ mode: "thinking" }), 300);

    let conv = conversation;
    let isNewConversation = false;

    // Top-level try/catch/finally — finally must always run so that a throw
    // from createConversation / saveMessages / fetch can never strand the
    // typing indicator or the neural-network brain state.
    try {
      if (!conv) {
        conv = await createConversation(userMsg);
        setConversation(conv);
        isNewConversation = true;
        // Don't call onConversationCreated yet — it changes the key and remounts us
      } else {
        await saveMessages(conv.id, newMessages);
      }

      abortControllerRef.current = new AbortController();
      const response = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context_type: contextType,
          job_id: jobId,
          message: content,
          conversation_id: conv?.id,
          ...(directDepartment ? { direct_department: directDepartment } : {}),
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
        }),
        signal: abortControllerRef.current.signal,
      });

      const data = await response.json();

      if (data.routed_to) {
        setBrainState({ mode: "thinking", activeAgent: data.routed_to });
      }

      const assistantContent: string = response.ok
        ? data.content
        : data.content ||
          "I hit a snag — give me a sec and try again. If this keeps happening, let Eric know.";

      const assistantMsg: JarvisMessageType = {
        role: "assistant",
        content: assistantContent,
        timestamp: new Date().toISOString(),
      };

      const finalMessages = [...newMessages, assistantMsg];
      setMessages(finalMessages);

      if (conv) {
        await saveMessages(conv.id, finalMessages);
      }

      // Now safe to notify parent — response is already in state
      if (isNewConversation && conv) {
        onConversationCreated?.(conv.id);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;

      const errorMsg: JarvisMessageType = {
        role: "assistant",
        content:
          "Looks like I lost connection. Check your internet and try again.",
        timestamp: new Date().toISOString(),
      };

      const finalMessages = [...newMessages, errorMsg];
      setMessages(finalMessages);

      if (conv) {
        await saveMessages(conv.id, finalMessages);
      }
    } finally {
      setIsTyping(false);
      setBrainState({ mode: "idle" });
      abortControllerRef.current = null;
    }
  }

  const [inputFill, setInputFill] = useState("");

  function handleQuickAction(text: string) {
    handleSend(text);
  }

  function handleInputFill(text: string) {
    setInputFill(text);
  }

  const isMarketing = contextType === "marketing";
  const showQuickActions = messages.length < 2 && !isTyping;
  const showWelcome = messages.length === 0 && !loading;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground/60">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Job context banner */}
      {contextType === "job" && jobContext && (
        <div className="px-4 py-2.5 bg-muted border-b border-border/50 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Viewing:</span>
          <span className="text-xs font-medium text-foreground">
            {jobContext.customerName} — {jobContext.address}
          </span>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {showWelcome ? (
          <JarvisWelcome
            contextType={contextType}
            jobContext={jobContext ? { customerName: jobContext.customerName, address: jobContext.address } : undefined}
            onQuickAction={handleQuickAction}
            onInputFill={handleInputFill}
            brainState={brainState}
          />
        ) : (
          <div className="py-4 space-y-4">
            {messages.map((msg, i) => (
              <JarvisMessage key={i} message={msg} />
            ))}
            {isTyping && <JarvisTypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Quick actions */}
      {showQuickActions && !showWelcome && (
        <JarvisQuickActions
          contextType={contextType as "general" | "job" | "rnd" | "marketing" | "field-ops"}
          onSelect={handleQuickAction}
          fillMode={isMarketing}
          onFill={handleInputFill}
          damageType={jobContext?.damageType}
        />
      )}

      {/* Input — image attachments are Jarvis Core only (#198) */}
      <JarvisInput
        onSend={handleSend}
        onUploadAttachment={
          contextType === "general" && !directDepartment
            ? handleUploadAttachment
            : undefined
        }
        disabled={isTyping}
        fillValue={inputFill}
        onFillConsumed={() => setInputFill("")}
      />
    </div>
  );
}
