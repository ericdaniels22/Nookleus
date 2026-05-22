import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { MARKETING_SYSTEM_PROMPT } from "@/lib/jarvis/prompts/marketing";
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

// Marketing tool definitions for Claude API
const marketingToolDefinitions: Anthropic.Messages.Tool[] = [
  {
    name: "get_business_info",
    description:
      "Get AAA Disaster Recovery business details including company name, address, phone, website, and service area from company settings.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_services_list",
    description:
      "Get the list of services AAA Disaster Recovery offers, pulled from the damage types configuration.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_marketing_images",
    description:
      "Search the marketing image library for pre-approved branded images by category tags. Use this when recommending an image to pair with a social media post or marketing content.",
    input_schema: {
      type: "object" as const,
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            'Category tags to filter by, e.g. ["water-damage", "team", "seasonal"]',
        },
        limit: {
          type: "number",
          description: "Max results to return. Default 5.",
        },
      },
      required: [],
    },
  },
  {
    name: "save_draft",
    description:
      "Save a social media post draft to the marketing drafts queue for review. Use this after creating a social media post so it appears in the Social Media tab for Eric to review and post.",
    input_schema: {
      type: "object" as const,
      properties: {
        platform: {
          type: "string",
          enum: ["instagram", "facebook", "linkedin", "gbp"],
          description: "Which platform this post is for",
        },
        caption: {
          type: "string",
          description: "The full post caption/text",
        },
        hashtags: {
          type: "string",
          description: "Suggested hashtags as a single string",
        },
        recommended_image_id: {
          type: "string",
          description:
            "UUID of the recommended image from the marketing image library, if one was found",
        },
        image_brief: {
          type: "string",
          description:
            "Description of the ideal image if no suitable match was found in the library",
        },
      },
      required: ["platform", "caption"],
    },
  },
];

async function executeMarketingTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  supabase: ReturnType<typeof createServiceClient>
): Promise<string> {
  try {
    switch (toolName) {
      case "get_business_info": {
        const { data: settings, error } = await supabase
          .from("company_settings")
          .select("key, value");

        if (error) {
          return JSON.stringify({ error: error.message });
        }

        const info: Record<string, string> = {};
        for (const row of settings || []) {
          if (row.value) {
            info[row.key] = row.value;
          }
        }

        return JSON.stringify(info, null, 2);
      }

      case "get_services_list": {
        const { data: damageTypes, error } = await supabase
          .from("damage_types")
          .select("name, display_label")
          .order("sort_order", { ascending: true });

        if (error) {
          return JSON.stringify({ error: error.message });
        }

        return JSON.stringify(
          (damageTypes || []).map((d) => ({
            name: d.name,
            display_label: d.display_label,
          })),
          null,
          2
        );
      }

      case "get_marketing_images": {
        const tags = toolInput.tags as string[] | undefined;
        const limit = Math.min((toolInput.limit as number) || 5, 20);

        let query = supabase
          .from("marketing_assets")
          .select("id, file_name, description, tags")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (tags && tags.length > 0) {
          query = query.overlaps("tags", tags);
        }

        const { data, error } = await query;
        if (error) {
          return JSON.stringify({ error: error.message });
        }

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const results = (data || []).map((a) => ({
          id: a.id,
          file_name: a.file_name,
          description: a.description,
          tags: a.tags,
        }));

        return JSON.stringify({
          images: results,
          total: results.length,
          note: results.length === 0
            ? "No images found in the marketing library. Provide an image_brief description instead when saving the draft."
            : `Found ${results.length} image(s). Use the id when saving a draft with save_draft.`,
        }, null, 2);
      }

      case "save_draft": {
        const platform = toolInput.platform as string;
        const caption = toolInput.caption as string;
        const hashtags = (toolInput.hashtags as string) || null;
        const imageId = (toolInput.recommended_image_id as string) || null;
        const imageBrief = (toolInput.image_brief as string) || null;

        if (!platform || !caption) {
          return JSON.stringify({ error: "platform and caption are required" });
        }

        const { data, error } = await supabase
          .from("marketing_drafts")
          .insert({
            platform,
            caption,
            hashtags,
            image_id: imageId,
            image_brief: imageBrief,
            status: "draft",
            created_by: "marketing-agent",
          })
          .select()
          .single();

        if (error) {
          return JSON.stringify({ error: error.message });
        }

        return JSON.stringify({
          success: true,
          draft_id: data.id,
          message: `Draft saved for ${platform}. It will appear on the Social Media tab for review.`,
        });
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
      attachments,
      org_id,
    }: {
      question: string;
      context?: string;
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

    // Build tools array — include web_search as a native tool
    const allTools: Anthropic.Messages.Tool[] = [
      ...marketingToolDefinitions,
      {
        type: "web_search_20250305",
        name: "web_search",
      } as unknown as Anthropic.Messages.Tool,
    ];

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
          system: MARKETING_SYSTEM_PROMPT,
          messages: withPromptCache(claudeMessages),
          tools: allTools,
          betas: [ANTHROPIC_FILES_BETA],
        },
        { timeout: CLAUDE_TIMEOUT_MS }
      );
    } catch (apiErr) {
      const status = (apiErr as { status?: number }).status;
      const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      console.error(
        `Marketing Claude API call failed [status=${status}]:`,
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
        // web_search is handled natively by Claude — skip execution
        if (toolUse.name === "web_search") continue;

        const result = await executeMarketingTool(
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
            system: MARKETING_SYSTEM_PROMPT,
            messages: withPromptCache(claudeMessages),
            tools: allTools,
            betas: [ANTHROPIC_FILES_BETA],
          },
          { timeout: CLAUDE_TIMEOUT_MS }
        );
      } catch (apiErr) {
        const status = (apiErr as { status?: number }).status;
        const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        console.error(
          `Marketing Claude API call failed on iteration ${iterations} [status=${status}]:`,
          msg
        );
        throw apiErr;
      }
    }

    // Extract final text
    const textBlocks = response.content.filter(
      (block): block is Anthropic.Beta.BetaTextBlock => block.type === "text"
    );
    const marketingResponse =
      textBlocks.map((b) => b.text).join("\n") ||
      "Marketing was unable to generate a response. Try rephrasing the request.";

    return NextResponse.json({ content: marketingResponse });
  } catch (err) {
    console.error("Marketing API error:", err);
    return NextResponse.json(
      {
        error: "Marketing processing failed",
        content:
          "The Marketing department hit a wall on this one. Try again or rephrase the request.",
      },
      { status: 500 }
    );
  }
}
