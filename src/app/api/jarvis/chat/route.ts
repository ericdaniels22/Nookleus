import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { withRequestContext } from "@/lib/request-context/with-request-context";
import { buildSystemPrompt } from "@/lib/jarvis/prompts/jarvis-core";
import {
  jarvisToolDefinitions,
  executeJarvisTool,
} from "@/lib/jarvis/tools";
import { buildClaudeMessages } from "@/lib/jarvis/attachments/content-blocks";
import {
  loadAttachmentBase64,
  type StorageClient,
} from "@/lib/jarvis/attachments/storage";
import { ANTHROPIC_FILES_BETA } from "@/lib/jarvis/attachments/anthropic-files";
import type { JarvisAttachment, JarvisMessage } from "@/lib/types";

export const maxDuration = 120;

const MAX_TOOL_ITERATIONS = 5;
const MAX_CONVERSATION_MESSAGES = 30;

// Shape of a `job_adjusters` row as selected for the job-context lookup
// below — the Service client returns these loosely typed.
interface JobAdjusterRow {
  is_primary: boolean;
  adjuster: { full_name: string; email: string | null } | null;
}

// Cookie-authenticated (logged-in only) — the wrapper resolves the caller
// and the Active Organization. Jarvis reads broadly across the org, so it
// asks the wrapper for the Service client.
export const POST = withRequestContext(
  { serviceClient: true },
  async (request, ctx) => {
  try {
    // Parse request
    const body = await request.json();
    const {
      context_type,
      job_id,
      message,
      conversation_id,
      direct_department,
      attachment,
    }: {
      context_type: "general" | "job" | "rnd" | "marketing";
      job_id?: string;
      message: string;
      conversation_id?: string;
      direct_department?: "rnd" | "marketing" | "field-ops";
      attachment?: JarvisAttachment;
    } = body;

    if (!message || !context_type) {
      return NextResponse.json(
        { error: "message and context_type are required" },
        { status: 400 }
      );
    }

    // Service client for broad data access — opted in via the rule.
    const supabase = ctx.serviceClient!;

    // Fetch user profile. The membership role is already resolved by the
    // wrapper and carried on the Request Context.
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("full_name")
      .eq("id", ctx.userId)
      .single();

    const userName = profile?.full_name || "User";
    const userRole = ctx.role || "crew_member";

    // Build context for system prompt
    let jobData = null;
    let businessSnapshot = null;

    if (context_type === "job" && job_id) {
      // Fetch job context — scoped to the caller's org so a job_id from
      // another tenant is not loadable (#120).
      const { data: job } = await supabase
        .from("jobs")
        .select(
          "*, contact:contacts!contact_id(full_name), job_adjusters(*, adjuster:contacts!contact_id(full_name, email))"
        )
        .eq("id", job_id)
        .eq("organization_id", ctx.orgId)
        .single();

      if (job) {
        jobData = {
          id: job.id,
          jobNumber: job.job_number,
          customerName: job.contact ? job.contact.full_name : "Unknown",
          address: job.property_address,
          status: job.status,
          damageType: job.damage_type,
          urgency: job.urgency,
          insuranceCompany: job.insurance_company,
          claimNumber: job.claim_number,
          adjusterName: (() => {
            const adj = job.job_adjusters?.find((ja: JobAdjusterRow) => ja.is_primary)?.adjuster;
            return adj ? adj.full_name : null;
          })(),
          adjusterEmail: job.job_adjusters?.find((ja: JobAdjusterRow) => ja.is_primary)?.adjuster?.email || null,
          createdAt: job.created_at,
        };
      }
    } else {
      // Fetch business snapshot for general context — every read scoped to
      // the caller's org so the snapshot reflects one tenant only (#120).
      const activeStatuses = ["new", "in_progress", "pending_invoice"];

      const { data: allJobs } = await supabase
        .from("jobs")
        .select("status")
        .eq("organization_id", ctx.orgId);

      const jobsByStatus: Record<string, number> = {};
      let activeCount = 0;
      for (const j of allJobs || []) {
        jobsByStatus[j.status] = (jobsByStatus[j.status] || 0) + 1;
        if (activeStatuses.includes(j.status)) activeCount++;
      }

      // Outstanding balance
      const { data: activeJobIds } = await supabase
        .from("jobs")
        .select("id")
        .eq("organization_id", ctx.orgId)
        .in("status", activeStatuses);

      let totalOutstanding = 0;
      if (activeJobIds && activeJobIds.length > 0) {
        const ids = activeJobIds.map((j) => j.id);
        const { data: invoices } = await supabase
          .from("invoices")
          .select("total_amount")
          .eq("organization_id", ctx.orgId)
          .in("job_id", ids)
          .in("status", ["draft", "sent", "partial"]);

        const { data: payments } = await supabase
          .from("payments")
          .select("amount")
          .eq("organization_id", ctx.orgId)
          .in("job_id", ids)
          .eq("status", "received");

        const totalInvoiced = (invoices || []).reduce(
          (s, i) => s + Number(i.total_amount),
          0
        );
        const totalPaid = (payments || []).reduce(
          (s, p) => s + Number(p.amount),
          0
        );
        totalOutstanding = Math.max(0, totalInvoiced - totalPaid);
      }

      // Overdue follow-ups
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data: activeJobs } = await supabase
        .from("jobs")
        .select("id, updated_at")
        .eq("organization_id", ctx.orgId)
        .in("status", activeStatuses);

      let overdueCount = 0;
      if (activeJobs && activeJobs.length > 0) {
        const { data: recentActivities } = await supabase
          .from("job_activities")
          .select("job_id, created_at")
          .eq("organization_id", ctx.orgId)
          .in(
            "job_id",
            activeJobs.map((j) => j.id)
          )
          .order("created_at", { ascending: false });

        const latestByJob: Record<string, string> = {};
        for (const a of recentActivities || []) {
          if (!latestByJob[a.job_id]) latestByJob[a.job_id] = a.created_at;
        }

        for (const j of activeJobs) {
          const last = latestByJob[j.id] || j.updated_at;
          if (last < sevenDaysAgo) overdueCount++;
        }
      }

      businessSnapshot = {
        activeJobCount: activeCount,
        jobsByStatus,
        totalOutstanding,
        overdueCount,
      };
    }

    // Detect @rnd, @marketing, or @fieldops prefix or direct_department routing
    const isRndDirect =
      direct_department === "rnd" || message.trim().toLowerCase().startsWith("@rnd");
    const isMarketingDirect =
      direct_department === "marketing" || message.trim().toLowerCase().startsWith("@marketing");
    const isFieldOpsDirect =
      direct_department === "field-ops" || message.trim().toLowerCase().startsWith("@fieldops");

    // Auto-route to field-ops: restoration terms + job context
    const FIELD_OPS_TERMS = /\b(water damage|drying|moisture|dehumidifier|air mover|containment|PPE|mold|remediation|category [123]|class [1234]|fire damage|smoke|soot|char|hvac restoration|antimicrobial|iicrc|water category|water class|drying goal|equipment placement|mold condition|clearance testing)\b/i;
    const isFieldOpsAuto =
      !isRndDirect &&
      !isMarketingDirect &&
      !isFieldOpsDirect &&
      context_type === "job" &&
      FIELD_OPS_TERMS.test(message);

    const cleanMessage = message
      .trim()
      .replace(/^@rnd\s*/i, "")
      .replace(/^@marketing\s*/i, "")
      .replace(/^@fieldops\s*/i, "");

    // If direct department routing, call department then wrap through Jarvis personality
    let assistantContent: string;
    let routedTo: string | null = null;

    if (isRndDirect || isMarketingDirect || isFieldOpsDirect || isFieldOpsAuto) {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
        || "http://localhost:3000";

      const departmentEndpoint = isFieldOpsDirect || isFieldOpsAuto
        ? "field-ops"
        : isRndDirect
          ? "rnd"
          : "marketing";
      routedTo = departmentEndpoint;

      const deptBody: Record<string, unknown> = {
        question: cleanMessage,
      };
      if (context_type === "job" && jobData) {
        deptBody.context = `Job context: ${jobData.customerName} at ${jobData.address}, ${jobData.damageType} damage, status: ${jobData.status}`;
      }
      if (departmentEndpoint === "field-ops" && job_id) {
        deptBody.job_id = job_id;
      }

      const deptResponse = await fetch(`${baseUrl}/api/jarvis/${departmentEndpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        },
        body: JSON.stringify(deptBody),
      });

      const deptData = await deptResponse.json();
      const deptLabels: Record<string, string> = {
        rnd: "R&D",
        marketing: "Marketing",
        "field-ops": "Field Operations",
      };
      const deptLabel = deptLabels[departmentEndpoint] || departmentEndpoint;
      const deptContent = deptData.content || `${deptLabel} wasn't able to process that one. Try rephrasing.`;

      // Light Jarvis personality pass on the department response
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const personalityResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: `You are Jarvis, relaying a response from your ${deptLabel} department. Keep the content intact but deliver it in your voice — warm, direct, and with your characteristic wit. Don't add fluff, just make it sound like you. If the ${deptLabel} answer is already well-structured, you can keep it mostly as-is with light personality touches. The user is ${userName} (${userRole}).`,
        messages: [
          {
            role: "user",
            content: `The user asked: "${cleanMessage}"\n\n${deptLabel} department response:\n${deptContent}\n\nDeliver this in your voice.`,
          },
        ],
      });

      const personalityBlocks = personalityResponse.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      assistantContent = personalityBlocks.map((b) => b.text).join("\n") || deptContent;
    } else {
      // Normal Jarvis flow
      // Build system prompt
      const systemPrompt = buildSystemPrompt({
        userName,
        userRole,
        contextType: (context_type === "rnd" || context_type === "marketing") ? "general" : context_type,
        jobData,
        businessSnapshot,
      });

      // Load conversation history
      let conversationMessages_inner: JarvisMessage[] = [];
      if (conversation_id) {
        const { data: conv } = await supabase
          .from("jarvis_conversations")
          .select("messages")
          .eq("id", conversation_id)
          .single();

        if (conv?.messages) {
          conversationMessages_inner = conv.messages as JarvisMessage[];
        }
      }

      // The incoming user message — carries its attachment, if any, so it
      // sits in the history window like every other message.
      const incomingUserMessage: JarvisMessage = {
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
        ...(attachment ? { attachment } : {}),
      };

      // Build messages for Claude — truncate to the window, then resolve
      // every attachment reference to a base64 image block. Jarvis re-sees
      // every image in the window on each turn (#198 replay), not just the
      // one freshly attached.
      const windowMessages = [
        ...conversationMessages_inner,
        incomingUserMessage,
      ].slice(-MAX_CONVERSATION_MESSAGES);

      // Beta message params — a PDF document block uses a `file` source,
      // which is a Files-API beta feature, so the Jarvis call below runs
      // on `anthropic.beta.messages.create` (#199).
      const claudeMessages: Anthropic.Beta.BetaMessageParam[] =
        await buildClaudeMessages(windowMessages, async (att) => {
          // Defense-in-depth: an attachment path always begins with its
          // owning org id. Refuse to load bytes from outside the caller's
          // Organization even if a crafted reference reaches the window —
          // buildClaudeMessages degrades the message to text on a throw.
          if (!att.storage_path.startsWith(`${ctx.orgId}/`)) {
            throw new Error("Attachment outside caller's organization");
          }
          return {
            base64: await loadAttachmentBase64(
              supabase as unknown as StorageClient,
              att.storage_path,
            ),
            mediaType: att.media_type,
          };
        },
      );

      // Call Claude API
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      let response = await anthropic.beta.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: claudeMessages,
        tools: jarvisToolDefinitions,
        betas: [ANTHROPIC_FILES_BETA],
      });

      // Tool use loop
      let iterations = 0;
      while (response.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        // Extract tool use blocks
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.Beta.BetaToolUseBlock =>
            block.type === "tool_use"
        );

        // Execute each tool
        const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const toolUse of toolUseBlocks) {
          if (toolUse.name === "consult_rnd") {
            routedTo = "rnd";
          } else if (toolUse.name === "consult_marketing") {
            routedTo = "marketing";
          }
          const result = await executeJarvisTool(
            toolUse.name,
            toolUse.input as Record<string, unknown>,
            {
              userId: ctx.userId,
              userName,
              userRole,
              jobId: job_id,
              supabase,
              orgId: ctx.orgId,
            }
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: result,
          });
        }

        // Continue conversation with tool results
        claudeMessages.push({ role: "assistant", content: response.content });
        claudeMessages.push({ role: "user", content: toolResults });

        response = await anthropic.beta.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: systemPrompt,
          messages: claudeMessages,
          tools: jarvisToolDefinitions,
          betas: [ANTHROPIC_FILES_BETA],
        });
      }

      // Extract final text response
      const textBlocks = response.content.filter(
        (block): block is Anthropic.Beta.BetaTextBlock =>
          block.type === "text"
      );
      assistantContent =
        textBlocks.map((b) => b.text).join("\n") ||
        "I ran into an issue processing that. Could you try again?";
    }

    // Load conversation messages for saving (need to reload since direct R&D path skipped earlier load)
    let conversationMessages: JarvisMessage[] = [];
    if (conversation_id) {
      const { data: conv } = await supabase
        .from("jarvis_conversations")
        .select("messages")
        .eq("id", conversation_id)
        .single();

      if (conv?.messages) {
        conversationMessages = conv.messages as JarvisMessage[];
      }
    }

    // Save messages to conversation
    const now = new Date().toISOString();
    const userMsg: JarvisMessage = {
      role: "user",
      content: message,
      timestamp: now,
      // Stored inline in the conversation `messages` JSONB — no separate
      // attachments table (#198).
      ...(attachment ? { attachment } : {}),
    };
    const assistantMsg: JarvisMessage = {
      role: "assistant",
      content: assistantContent,
      timestamp: new Date().toISOString(),
    };

    const updatedMessages = [...conversationMessages, userMsg, assistantMsg];

    if (conversation_id) {
      // Auto-title on first response if no title yet
      const { data: conv } = await supabase
        .from("jarvis_conversations")
        .select("title")
        .eq("id", conversation_id)
        .single();

      const updates: Record<string, unknown> = {
        messages: updatedMessages,
        updated_at: new Date().toISOString(),
      };

      // Set title from first user message if it's still the default
      if (
        conv &&
        (!conv.title || conv.title === message.slice(0, 47) + "..." || conv.title === message)
      ) {
        const words = message.split(" ");
        let title = "";
        for (const word of words) {
          if ((title + " " + word).trim().length > 50) break;
          title = (title + " " + word).trim();
        }
        if (title.length < message.length) title += "...";
        updates.title = title;
      }

      await supabase
        .from("jarvis_conversations")
        .update(updates)
        .eq("id", conversation_id);
    }

    return NextResponse.json({
      content: assistantContent,
      conversation_id: conversation_id || null,
      routed_to: routedTo,
    });
  } catch (err) {
    console.error("Jarvis API error:", err);
    return NextResponse.json(
      {
        error: "Something went wrong",
        content:
          "I hit a snag — give me a sec and try again. If this keeps happening, let Eric know.",
      },
      { status: 500 }
    );
  }
  },
);
