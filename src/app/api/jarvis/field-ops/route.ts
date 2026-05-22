import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { buildFieldOpsPrompt } from "@/lib/jarvis/prompts/field-ops";
import { embedQuery } from "@/lib/knowledge/embeddings";
import { buildClaudeMessages } from "@/lib/jarvis/attachments/content-blocks";
import {
  orgScopedImageResolver,
  type StorageClient,
} from "@/lib/jarvis/attachments/storage";
import { ANTHROPIC_FILES_BETA } from "@/lib/jarvis/attachments/anthropic-files";
import { withPromptCache } from "@/lib/jarvis/prompt-cache";
import type { JarvisAttachment } from "@/lib/types";

export const maxDuration = 60;

const MAX_TOOL_ITERATIONS = 5;
const CLAUDE_TIMEOUT_MS = 60_000;

// Field Ops tool definitions for Claude API
const fieldOpsToolDefinitions: Anthropic.Messages.Tool[] = [
  {
    name: "get_job_context",
    description:
      "Get the current job's details including damage type, water category/class, rooms affected, materials noted, crew activity log, and status. Use this to understand the job before answering restoration questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: {
          type: "string",
          description: "The job UUID to look up",
        },
      },
      required: ["job_id"],
    },
  },
  {
    name: "get_moisture_readings",
    description:
      "Retrieve moisture reading history for a specific job. Returns timestamped readings with location, material, meter type, and value. Use this to assess drying progress, flag stalled drying, and recommend equipment adjustments.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: {
          type: "string",
          description: "The job UUID to get readings for",
        },
        limit: {
          type: "number",
          description: "Max readings to return. Default 20.",
        },
      },
      required: ["job_id"],
    },
  },
  {
    name: "get_safety_alerts",
    description:
      "Check for known hazards on a job: asbestos flagged, lead paint (pre-1978), confined spaces, mold present, biohazard categories, and safety notes in the activity log. Use this proactively to warn crew about hazards.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: {
          type: "string",
          description: "The job UUID to check safety for",
        },
      },
      required: ["job_id"],
    },
  },
  {
    name: "search_knowledge_base",
    description:
      "Search the Tier 2 RAG knowledge base containing the full IICRC standards (S500, S520, S700) stored in pgvector. Use this for deep procedural questions that exceed the condensed reference coverage in your prompt. Returns the top 5 most relevant chunks with content, section number, section title, and similarity score.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "The search query. Be specific — e.g. 'HVAC restoration procedures for smoke damage' rather than just 'HVAC'.",
        },
        standard_id: {
          type: "string",
          description:
            "Optional filter by standard: S500, S520, or S700. Omit to search all standards.",
        },
      },
      required: ["query"],
    },
  },
];

async function executeFieldOpsTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  supabase: ReturnType<typeof createServiceClient>
): Promise<string> {
  try {
    switch (toolName) {
      case "get_job_context": {
        const jobId = toolInput.job_id as string;
        if (!jobId) return JSON.stringify({ error: "job_id is required" });

        // Get job with contact info
        const { data: job, error: jobError } = await supabase
          .from("jobs")
          .select("*, contact:contacts(*), job_adjusters(*, adjuster:contacts!contact_id(*))")
          .eq("id", jobId)
          .single();

        if (jobError || !job) {
          return JSON.stringify({ error: jobError?.message || "Job not found" });
        }

        // Get recent activity log
        const { data: activities } = await supabase
          .from("job_activities")
          .select("activity_type, title, description, author, created_at")
          .eq("job_id", jobId)
          .order("created_at", { ascending: false })
          .limit(10);

        // Get custom fields (may contain water category, class, etc.)
        const { data: customFields } = await supabase
          .from("job_custom_fields")
          .select("field_key, field_value")
          .eq("job_id", jobId);

        const customMap: Record<string, string> = {};
        for (const f of customFields || []) {
          if (f.field_value) customMap[f.field_key] = f.field_value;
        }

        // Calculate days since start
        const daysSinceStart = Math.floor(
          (Date.now() - new Date(job.created_at).getTime()) / (1000 * 60 * 60 * 24)
        );

        return JSON.stringify(
          {
            job_id: job.id,
            job_number: job.job_number,
            status: job.status,
            damage_type: job.damage_type,
            property_address: job.property_address,
            property_type: job.property_type,
            affected_areas: job.affected_areas,
            urgency: job.urgency,
            customer: job.contact ? job.contact.full_name : "Unknown",
            days_since_start: daysSinceStart,
            custom_fields: customMap,
            recent_activities: (activities || []).map((a) => ({
              type: a.activity_type,
              title: a.title,
              description: a.description,
              author: a.author,
              date: a.created_at,
            })),
          },
          null,
          2
        );
      }

      case "get_moisture_readings": {
        const jobId = toolInput.job_id as string;
        if (!jobId) return JSON.stringify({ error: "job_id is required" });

        const limit = Math.min((toolInput.limit as number) || 20, 50);

        // Moisture readings are stored as activities with type "equipment" or as custom fields
        // Check activity log for moisture-related entries
        const { data: readings } = await supabase
          .from("job_activities")
          .select("title, description, author, created_at")
          .eq("job_id", jobId)
          .ilike("title", "%moisture%")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (!readings || readings.length === 0) {
          return JSON.stringify({
            readings: [],
            message:
              "No moisture readings found for this job. Readings may not have been logged yet.",
          });
        }

        return JSON.stringify(
          {
            readings: readings.map((r) => ({
              title: r.title,
              description: r.description,
              recorded_by: r.author,
              date: r.created_at,
            })),
            total: readings.length,
          },
          null,
          2
        );
      }

      case "get_safety_alerts": {
        const jobId = toolInput.job_id as string;
        if (!jobId) return JSON.stringify({ error: "job_id is required" });

        // Get job for property info
        const { data: job } = await supabase
          .from("jobs")
          .select("damage_type, property_type, property_sqft, created_at, access_notes")
          .eq("id", jobId)
          .single();

        // Check activity log for safety-related entries
        const { data: safetyActivities } = await supabase
          .from("job_activities")
          .select("title, description, author, created_at")
          .eq("job_id", jobId)
          .or(
            "title.ilike.%safety%,title.ilike.%hazard%,title.ilike.%asbestos%,title.ilike.%lead%,title.ilike.%confined%,title.ilike.%mold%,title.ilike.%biohazard%,title.ilike.%PPE%"
          )
          .order("created_at", { ascending: false })
          .limit(10);

        // Get custom fields for safety flags
        const { data: customFields } = await supabase
          .from("job_custom_fields")
          .select("field_key, field_value")
          .eq("job_id", jobId);

        const safetyFlags: string[] = [];
        for (const f of customFields || []) {
          const key = f.field_key.toLowerCase();
          if (
            key.includes("asbestos") ||
            key.includes("lead") ||
            key.includes("safety") ||
            key.includes("hazard") ||
            key.includes("confined")
          ) {
            safetyFlags.push(`${f.field_key}: ${f.field_value}`);
          }
        }

        return JSON.stringify(
          {
            job_damage_type: job?.damage_type || "Unknown",
            access_notes: job?.access_notes || null,
            safety_flags: safetyFlags,
            safety_activities: (safetyActivities || []).map((a) => ({
              title: a.title,
              description: a.description,
              date: a.created_at,
            })),
            reminders: [
              "Always check for asbestos in pre-1980 buildings",
              "Always check for lead paint in pre-1978 buildings",
              "Verify PPE requirements match the water category and damage type",
            ],
          },
          null,
          2
        );
      }

      case "search_knowledge_base": {
        const query = toolInput.query as string;
        if (!query) return JSON.stringify({ error: "query is required" });

        const standardId = toolInput.standard_id as string | undefined;

        try {
          // Embed the query
          const queryEmbedding = await embedQuery(query);

          // Search via Supabase RPC
          const { data, error } = await supabase.rpc(
            "search_knowledge_chunks",
            {
              query_embedding: JSON.stringify(queryEmbedding),
              match_count: 5,
              filter_document_id: null,
            }
          );

          if (error) {
            return JSON.stringify({ error: `Search failed: ${error.message}` });
          }

          let results = data || [];

          // Filter by standard_id if provided
          if (standardId && results.length > 0) {
            const docIds = [
              ...new Set(
                results.map((r: { document_id: string }) => r.document_id)
              ),
            ];
            const { data: docs } = await supabase
              .from("knowledge_documents")
              .select("id, standard_id")
              .in("id", docIds)
              .eq("standard_id", standardId);

            if (docs) {
              const matchingDocIds = new Set(docs.map((d) => d.id));
              results = results.filter((r: { document_id: string }) =>
                matchingDocIds.has(r.document_id)
              );
            }
          }

          if (results.length === 0) {
            return JSON.stringify({
              results: [],
              message:
                "No relevant sections found in the knowledge base. Try a different search query or check if the standards have been ingested.",
            });
          }

          return JSON.stringify(
            {
              results: results.map(
                (r: {
                  content: string;
                  section_number: string;
                  section_title: string;
                  similarity: number;
                }) => ({
                  section_number: r.section_number,
                  section_title: r.section_title,
                  content: r.content,
                  similarity: Math.round(r.similarity * 100) / 100,
                })
              ),
              source: "IICRC Full Standards (Tier 2 RAG)",
            },
            null,
            2
          );
        } catch (err) {
          return JSON.stringify({
            error: `Knowledge base search failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          });
        }
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({
      error: `Tool execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      question,
      context,
      job_id,
      attachments,
      org_id,
    }: {
      question: string;
      context?: string;
      job_id?: string;
      // Chat attachments that rode in with the routed turn (#201), plus
      // the caller's org id so each storage path can be scope-checked.
      attachments?: JarvisAttachment[];
      org_id?: string;
    } = body;

    if (!question) {
      return NextResponse.json(
        { error: "question is required" },
        { status: 400 }
      );
    }

    // Authenticate — accept either cookie auth OR internal service key
    const internalKey = request.headers.get("x-service-key");
    const isInternalCall =
      internalKey && internalKey === process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!isInternalCall) {
      const authSupabase = await createServerSupabaseClient();
      const {
        data: { user },
        error: authError,
      } = await authSupabase.auth.getUser();

      if (authError || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const supabase = createServiceClient();

    // Build the system prompt with optional job context
    let jobContext: Parameters<typeof buildFieldOpsPrompt>[0];
    if (job_id) {
      const { data: job } = await supabase
        .from("jobs")
        .select("*")
        .eq("id", job_id)
        .single();

      if (job) {
        const { data: customFields } = await supabase
          .from("job_custom_fields")
          .select("field_key, field_value")
          .eq("job_id", job_id);

        const customMap: Record<string, string> = {};
        for (const f of customFields || []) {
          if (f.field_value) customMap[f.field_key] = f.field_value;
        }

        jobContext = {
          jobId: job.id,
          address: job.property_address,
          status: job.status,
          damageType: job.damage_type,
          waterCategory: customMap.water_category,
          waterClass: customMap.water_class,
          rooms: job.affected_areas || undefined,
          daysSinceStart: Math.floor(
            (Date.now() - new Date(job.created_at).getTime()) /
              (1000 * 60 * 60 * 24)
          ),
        };
      }
    }

    const systemPrompt = buildFieldOpsPrompt(jobContext);

    // Build the user message
    let userContent = question;
    if (context) {
      userContent += `\n\nAdditional context: ${context}`;
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Build the Claude messages via the shared content-block assembly
    // module — routed Chat attachments (#201) become image/document
    // blocks on the user turn. Defense-in-depth: an attachment path
    // always begins with its owning org id, so bytes outside the caller's
    // Organization are never loaded (buildClaudeMessages degrades to text
    // on a throw).
    const claudeMessages: Anthropic.Beta.BetaMessageParam[] =
      await buildClaudeMessages(
        [
          {
            role: "user",
            content: userContent,
            timestamp: new Date().toISOString(),
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          },
        ],
        orgScopedImageResolver(
          supabase as unknown as StorageClient,
          org_id ?? null,
        ),
      );

    // Runs on the beta Messages API so a routed PDF document block (#199)
    // is accepted alongside image blocks. A cache_control breakpoint on
    // the last block of the last message caches the rendered prefix
    // (tools → system → messages) so replayed image and document blocks
    // hit the cache on follow-up turns (#203).
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await anthropic.beta.messages.create(
        {
          model: "claude-sonnet-4-20250514",
          max_tokens: 8192,
          system: systemPrompt,
          messages: withPromptCache(claudeMessages),
          tools: fieldOpsToolDefinitions,
          betas: [ANTHROPIC_FILES_BETA],
        },
        { timeout: CLAUDE_TIMEOUT_MS }
      );
    } catch (apiErr) {
      const status = (apiErr as { status?: number }).status;
      const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      console.error(
        `Field Ops Claude API call failed [status=${status}]:`,
        msg
      );
      throw apiErr;
    }

    // Tool use loop
    let iterations = 0;
    while (
      response.stop_reason === "tool_use" &&
      iterations < MAX_TOOL_ITERATIONS
    ) {
      iterations++;

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlock =>
          block.type === "tool_use"
      );

      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeFieldOpsTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          supabase
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      claudeMessages.push({ role: "assistant", content: response.content });
      if (toolResults.length > 0) {
        claudeMessages.push({ role: "user", content: toolResults });
      }

      try {
        response = await anthropic.beta.messages.create(
          {
            model: "claude-sonnet-4-20250514",
            max_tokens: 8192,
            system: systemPrompt,
            messages: withPromptCache(claudeMessages),
            tools: fieldOpsToolDefinitions,
            betas: [ANTHROPIC_FILES_BETA],
          },
          { timeout: CLAUDE_TIMEOUT_MS }
        );
      } catch (apiErr) {
        const status = (apiErr as { status?: number }).status;
        const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        console.error(
          `Field Ops Claude API call failed on iteration ${iterations} [status=${status}]:`,
          msg
        );
        throw apiErr;
      }
    }

    // Extract final text
    const textBlocks = response.content.filter(
      (block): block is Anthropic.Beta.BetaTextBlock => block.type === "text"
    );
    const fieldOpsResponse =
      textBlocks.map((b) => b.text).join("\n") ||
      "Field Operations was unable to generate a response. Try rephrasing the question.";

    return NextResponse.json({ content: fieldOpsResponse });
  } catch (err) {
    console.error("Field Ops API error:", err);
    return NextResponse.json(
      {
        error: "Field Operations processing failed",
        content:
          "Field Operations hit a snag on this one. Try again or rephrase the question.",
      },
      { status: 500 }
    );
  }
}
