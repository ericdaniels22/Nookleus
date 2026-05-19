import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";

// --- Types ---

export interface ToolExecutionContext {
  userId: string;
  userName: string;
  userRole: string;
  jobId?: string;
  supabase: SupabaseClient;
  // The caller's Active Organization. Every tool runs against the Service
  // client, which bypasses row-level security, so each data query must scope
  // to this value itself (#120). Null when the caller has no membership in
  // the Active Organization — scoping by null then matches nothing, which is
  // the safe outcome.
  orgId: string | null;
}

// --- Tool Definitions for Claude API ---

export const jarvisToolDefinitions: Tool[] = [
  {
    name: "get_job_details",
    description:
      "Fetch complete details for a specific job including customer info, billing, activities, photos, and emails. Use when the user asks about a specific job or needs refreshed data.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: {
          type: "string",
          description: "The UUID of the job to look up",
        },
      },
      required: ["job_id"],
    },
  },
  {
    name: "search_jobs",
    description:
      "Search across all jobs with optional filters. Use when the user asks about job listings, wants to find a specific job by name or address, or asks broad questions like 'how many active jobs' or 'show me all mold jobs'.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Search text to match against customer name or address",
        },
        status: {
          type: "string",
          description:
            "Filter by job status: new, in_progress, pending_invoice, completed, cancelled",
        },
        damage_type: {
          type: "string",
          description:
            "Filter by damage type: water, fire, mold, storm, biohazard, contents, rebuild",
        },
        limit: {
          type: "number",
          description: "Max results to return. Default 10, max 25.",
        },
      },
    },
  },
  {
    name: "get_business_metrics",
    description:
      "Get business overview metrics including revenue, job counts, outstanding balances, and overdue follow-ups. Use when the user asks how the business is doing, wants revenue numbers, or asks about overall performance.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          enum: ["today", "week", "month", "quarter"],
          description: "Time period for metrics. Default: month.",
        },
      },
    },
  },
  {
    name: "log_activity",
    description:
      "Log an activity entry on a job's timeline. Use when a user asks you to record something that happened on a job.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: {
          type: "string",
          description: "The job to log the activity on",
        },
        title: {
          type: "string",
          description: "Short title for the activity",
        },
        description: {
          type: "string",
          description: "Longer description of the activity (optional)",
        },
        activity_type: {
          type: "string",
          enum: ["note", "photo", "milestone", "insurance", "equipment"],
          description:
            "Type of activity. Use 'note' for general notes, moisture readings, and communications. Use 'milestone' for status changes and key project milestones. Use 'insurance' for insurance-related activities. Use 'equipment' for equipment deployments and pickups.",
        },
      },
      required: ["job_id", "title"],
    },
  },
  {
    name: "create_alert",
    description:
      "Create a reminder or alert for follow-up. Use when someone asks you to remind them about something or when you notice something that needs attention.",
    input_schema: {
      type: "object" as const,
      properties: {
        job_id: {
          type: "string",
          description: "The related job (optional for general alerts)",
        },
        message: {
          type: "string",
          description: "The alert message",
        },
        due_date: {
          type: "string",
          description: "When the alert should trigger (ISO 8601 date string)",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Alert priority level. Default: medium.",
        },
      },
      required: ["message", "due_date"],
    },
  },
  {
    name: "consult_rnd",
    description:
      "Route a question to the R&D department. Use when Eric asks about: improving the platform, adding new features, fixing bugs, how something in the app works, researching a technology or library, generating a build spec for Claude Code, checking if the system is healthy, or anything related to the software itself. Do NOT use for job-specific questions, business metrics, or field restoration guidance.",
    input_schema: {
      type: "object" as const,
      properties: {
        question: {
          type: "string",
          description:
            "The R&D question. Be specific about what's being asked.",
        },
        context: {
          type: "string",
          description:
            "Additional context — what prompted this, any constraints or preferences mentioned.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "consult_marketing",
    description:
      "Route to the Marketing department for content creation, ad copy, SEO, social media posts, Google Business Profile content, review responses, website copy, LLM/AI search optimization, and marketing strategy. Use this when the user asks for any marketing-related content or advice.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "The marketing question or content request to send to the Marketing department",
        },
      },
      required: ["query"],
    },
  },
];

// --- Activity type mapping ---

const VALID_ACTIVITY_TYPES = [
  "note",
  "photo",
  "milestone",
  "insurance",
  "equipment",
] as const;

const ACTIVITY_TYPE_MAP: Record<string, string> = {
  status_change: "milestone",
  moisture_reading: "note",
  communication: "note",
  inspection: "note",
  estimate: "insurance",
};

function resolveActivityType(input?: string): string {
  if (!input) return "note";
  if ((VALID_ACTIVITY_TYPES as readonly string[]).includes(input)) return input;
  return ACTIVITY_TYPE_MAP[input] || "note";
}

// --- Tool Dispatcher ---

export async function executeJarvisTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<string> {
  try {
    let result: unknown;
    switch (toolName) {
      case "get_job_details":
        result = await toolGetJobDetails(
          toolInput as { job_id: string },
          context
        );
        break;
      case "search_jobs":
        result = await toolSearchJobs(
          toolInput as {
            query?: string;
            status?: string;
            damage_type?: string;
            limit?: number;
          },
          context
        );
        break;
      case "get_business_metrics":
        result = await toolGetBusinessMetrics(
          toolInput as { period?: string },
          context
        );
        break;
      case "log_activity":
        result = await toolLogActivity(
          toolInput as {
            job_id: string;
            title: string;
            description?: string;
            activity_type?: string;
          },
          context
        );
        break;
      case "create_alert":
        result = await toolCreateAlert(
          toolInput as {
            message: string;
            due_date: string;
            priority?: string;
            job_id?: string;
          },
          context
        );
        break;
      case "consult_rnd":
        result = await toolConsultRnd(
          toolInput as { question: string; context?: string }
        );
        break;
      case "consult_marketing":
        result = await toolConsultMarketing(
          toolInput as { query: string }
        );
        break;
      default:
        result = { error: `Unknown tool: ${toolName}` };
    }
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({
      error: `Tool execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

// --- Individual Tool Executors ---

async function toolGetJobDetails(
  input: { job_id: string },
  ctx: ToolExecutionContext
) {
  const { supabase } = ctx;

  // Job with contact joins — scoped to the caller's org so a job_id from
  // another tenant reads as "not found".
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "*, contact:contacts!contact_id(*), job_adjusters(*, adjuster:contacts!contact_id(*))"
    )
    .eq("id", input.job_id)
    .eq("organization_id", ctx.orgId)
    .single();

  if (jobErr || !job) return { error: "Job not found" };

  // Activities (last 10)
  const { data: activities } = await supabase
    .from("job_activities")
    .select("*")
    .eq("job_id", input.job_id)
    .order("created_at", { ascending: false })
    .limit(10);

  // Invoices
  const { data: invoices } = await supabase
    .from("invoices")
    .select("*")
    .eq("job_id", input.job_id)
    .is("deleted_at", null);

  // Payments
  const { data: payments } = await supabase
    .from("payments")
    .select("*")
    .eq("job_id", input.job_id);

  // Photo count
  const { count: photoCount } = await supabase
    .from("photos")
    .select("*", { count: "exact", head: true })
    .eq("job_id", input.job_id);

  // Email count
  const { count: emailCount } = await supabase
    .from("emails")
    .select("*", { count: "exact", head: true })
    .eq("job_id", input.job_id);

  // Custom fields
  const { data: customFields } = await supabase
    .from("job_custom_fields")
    .select("field_key, field_value")
    .eq("job_id", input.job_id);

  // Billing summary
  const totalBilled = (invoices || []).reduce(
    (sum, inv) => sum + Number(inv.total_amount || 0),
    0
  );
  const insurancePaid = (payments || [])
    .filter((p) => p.status === "received" && p.source === "insurance")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const customerPaid = (payments || [])
    .filter((p) => p.status === "received" && p.source === "homeowner")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const totalPaid = (payments || [])
    .filter((p) => p.status === "received")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const contactName = job.contact ? job.contact.full_name : "Unknown";
  const primaryAdj = job.job_adjusters?.find((ja: any) => ja.is_primary)?.adjuster;
  const adjusterName = primaryAdj ? primaryAdj.full_name : null;

  return {
    id: job.id,
    job_number: job.job_number,
    customer_name: contactName,
    customer_phone: job.contact?.phone || null,
    customer_email: job.contact?.email || null,
    address: job.property_address,
    property_type: job.property_type,
    property_sqft: job.property_sqft,
    damage_type: job.damage_type,
    damage_source: job.damage_source,
    status: job.status,
    urgency: job.urgency,
    insurance_company: job.insurance_company,
    claim_number: job.claim_number,
    adjuster_name: adjusterName,
    adjuster_phone: primaryAdj?.phone || null,
    adjuster_email: primaryAdj?.email || null,
    affected_areas: job.affected_areas,
    access_notes: job.access_notes,
    created_at: job.created_at,
    updated_at: job.updated_at,
    custom_fields: customFields || [],
    billing: {
      total_billed: totalBilled,
      insurance_paid: insurancePaid,
      customer_paid: customerPaid,
      total_paid: totalPaid,
      remaining_balance: totalBilled - totalPaid,
    },
    recent_activities: (activities || []).map((a) => ({
      type: a.activity_type,
      title: a.title,
      description: a.description,
      author: a.author,
      date: a.created_at,
    })),
    photo_count: photoCount || 0,
    email_count: emailCount || 0,
  };
}

async function toolSearchJobs(
  input: {
    query?: string;
    status?: string;
    damage_type?: string;
    limit?: number;
  },
  ctx: ToolExecutionContext
) {
  const { supabase } = ctx;
  const limit = Math.min(input.limit || 10, 25);

  let query = supabase
    .from("jobs")
    .select("*, contact:contacts!contact_id(full_name)")
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.status) {
    query = query.eq("status", input.status);
  }
  if (input.damage_type) {
    query = query.eq("damage_type", input.damage_type);
  }

  const { data: jobs, error } = await query;
  if (error) return { error: error.message };

  let results = (jobs || []).map((j) => ({
    id: j.id,
    job_number: j.job_number,
    customer_name: j.contact ? j.contact.full_name : "Unknown",
    address: j.property_address,
    status: j.status,
    damage_type: j.damage_type,
    urgency: j.urgency,
    created_at: j.created_at,
  }));

  // Client-side filter by name/address if query provided
  if (input.query) {
    const q = input.query.toLowerCase();
    results = results.filter(
      (j) =>
        j.customer_name.toLowerCase().includes(q) ||
        j.address.toLowerCase().includes(q)
    );
  }

  return { jobs: results, total: results.length };
}

async function toolGetBusinessMetrics(
  input: { period?: string },
  ctx: ToolExecutionContext
) {
  const { supabase } = ctx;

  // Calculate date range
  const now = new Date();
  let startDate: Date;
  const period = input.period || "month";

  switch (period) {
    case "today":
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "week": {
      const day = now.getDay();
      startDate = new Date(now);
      startDate.setDate(now.getDate() - day);
      startDate.setHours(0, 0, 0, 0);
      break;
    }
    case "quarter": {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      startDate = new Date(now.getFullYear(), qMonth, 1);
      break;
    }
    default: // month
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const startISO = startDate.toISOString();

  // Jobs by status — scoped to the caller's org.
  const { data: allJobs } = await supabase
    .from("jobs")
    .select("status, created_at")
    .eq("organization_id", ctx.orgId);

  const jobsByStatus: Record<string, number> = {};
  let activeCount = 0;
  let jobsCreatedInPeriod = 0;
  const activeStatuses = ["new", "in_progress", "pending_invoice"];

  for (const j of allJobs || []) {
    jobsByStatus[j.status] = (jobsByStatus[j.status] || 0) + 1;
    if (activeStatuses.includes(j.status)) activeCount++;
    if (j.created_at >= startISO) jobsCreatedInPeriod++;
  }

  // Revenue in period (received payments)
  const { data: periodPayments } = await supabase
    .from("payments")
    .select("amount, source")
    .eq("organization_id", ctx.orgId)
    .eq("status", "received")
    .gte("created_at", startISO);

  const revenue = (periodPayments || []).reduce(
    (sum, p) => sum + Number(p.amount),
    0
  );
  const insuranceRevenue = (periodPayments || [])
    .filter((p) => p.source === "insurance")
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const customerRevenue = (periodPayments || [])
    .filter((p) => p.source === "homeowner")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  // Outstanding balance (unpaid invoices on active jobs)
  const { data: activeJobIds } = await supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", ctx.orgId)
    .in("status", activeStatuses);

  let outstandingBalance = 0;
  if (activeJobIds && activeJobIds.length > 0) {
    const ids = activeJobIds.map((j) => j.id);
    const { data: invoices } = await supabase
      .from("invoices")
      .select("total_amount")
      .eq("organization_id", ctx.orgId)
      .in("job_id", ids)
      .in("status", ["draft", "sent", "partial"])
      .is("deleted_at", null);

    const { data: receivedPayments } = await supabase
      .from("payments")
      .select("amount")
      .eq("organization_id", ctx.orgId)
      .in("job_id", ids)
      .eq("status", "received");

    const totalInvoiced = (invoices || []).reduce(
      (sum, i) => sum + Number(i.total_amount),
      0
    );
    const totalPaid = (receivedPayments || []).reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );
    outstandingBalance = totalInvoiced - totalPaid;
  }

  // Overdue follow-ups: active jobs with no activity in 7+ days
  const sevenDaysAgo = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: activeJobs } = await supabase
    .from("jobs")
    .select("id, job_number, property_address, updated_at")
    .eq("organization_id", ctx.orgId)
    .in("status", activeStatuses);

  let overdueCount = 0;
  const overdueJobs: { job_number: string; address: string }[] = [];

  if (activeJobs) {
    // Get latest activity per job
    const { data: recentActivities } = await supabase
      .from("job_activities")
      .select("job_id, created_at")
      .eq("organization_id", ctx.orgId)
      .in(
        "job_id",
        activeJobs.map((j) => j.id)
      )
      .order("created_at", { ascending: false });

    const latestActivityByJob: Record<string, string> = {};
    for (const a of recentActivities || []) {
      if (!latestActivityByJob[a.job_id]) {
        latestActivityByJob[a.job_id] = a.created_at;
      }
    }

    for (const j of activeJobs) {
      const lastActivity = latestActivityByJob[j.id] || j.updated_at;
      if (lastActivity < sevenDaysAgo) {
        overdueCount++;
        if (overdueJobs.length < 5) {
          overdueJobs.push({
            job_number: j.job_number,
            address: j.property_address,
          });
        }
      }
    }
  }

  return {
    period,
    active_jobs: activeCount,
    jobs_by_status: jobsByStatus,
    jobs_created_in_period: jobsCreatedInPeriod,
    revenue: {
      total: revenue,
      insurance: insuranceRevenue,
      customer: customerRevenue,
    },
    outstanding_balance: Math.max(0, outstandingBalance),
    overdue_followups: {
      count: overdueCount,
      examples: overdueJobs,
    },
  };
}

async function toolLogActivity(
  input: {
    job_id: string;
    title: string;
    description?: string;
    activity_type?: string;
  },
  ctx: ToolExecutionContext
) {
  const { supabase } = ctx;
  const activityType = resolveActivityType(input.activity_type);

  // Derive org from the parent job so the activity lands in the right tenant.
  // Scoped to the caller's org — a job_id from another tenant reads as
  // "not found", so the activity can never be written across the boundary.
  const { data: job } = await supabase
    .from("jobs")
    .select("organization_id")
    .eq("id", input.job_id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle<{ organization_id: string }>();
  if (!job) return { error: "job not found" };

  const { data, error } = await supabase
    .from("job_activities")
    .insert({
      organization_id: job.organization_id,
      job_id: input.job_id,
      activity_type: activityType,
      title: input.title,
      description: input.description || null,
      author: ctx.userName,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  // Update job's updated_at
  await supabase
    .from("jobs")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", input.job_id);

  return {
    success: true,
    activity_id: data.id,
    message: `Activity logged: "${input.title}" on job ${input.job_id}`,
  };
}

async function toolConsultRnd(
  input: { question: string; context?: string }
): Promise<{ content: string } | { error: string }> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
      || "http://localhost:3000";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const response = await fetch(`${baseUrl}/api/jarvis/rnd`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      },
      body: JSON.stringify({
        question: input.question,
        context: input.context,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json();
    if (!response.ok) {
      return { error: data.error || "R&D request failed" };
    }
    return { content: data.content };
  } catch (err) {
    return {
      error: `Failed to reach R&D: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

async function toolConsultMarketing(
  input: { query: string }
): Promise<{ content: string } | { error: string }> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
      || "http://localhost:3000";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    const response = await fetch(`${baseUrl}/api/jarvis/marketing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      },
      body: JSON.stringify({
        question: input.query,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json();
    if (!response.ok) {
      return { error: data.error || "Marketing request failed" };
    }
    return { content: data.content };
  } catch (err) {
    return {
      error: `Failed to reach Marketing: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

async function toolCreateAlert(
  input: {
    message: string;
    due_date: string;
    priority?: string;
    job_id?: string;
  },
  ctx: ToolExecutionContext
) {
  const { supabase } = ctx;

  // Alerts are tenant-scoped. If the alert references a job, use the job's
  // organization. Otherwise use the caller's active org from the JWT claim.
  // If neither is available the insert will fail on NOT NULL — loud, per the
  // 18b contract.
  let orgId: string | null = null;
  if (input.job_id) {
    // Scoped to the caller's org — a job_id from another tenant reads as
    // "not found", so its organization can never become the alert's.
    const { data: job } = await supabase
      .from("jobs")
      .select("organization_id")
      .eq("id", input.job_id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle<{ organization_id: string }>();
    orgId = job?.organization_id ?? null;
  }
  if (!orgId) {
    orgId = await getActiveOrganizationId(supabase);
  }
  if (!orgId) {
    return { error: "no active organization — cannot create alert" };
  }

  const { data, error } = await supabase
    .from("jarvis_alerts")
    .insert({
      organization_id: orgId,
      user_id: ctx.userId,
      job_id: input.job_id || null,
      message: input.message,
      due_date: input.due_date,
      priority: input.priority || "medium",
      status: "active",
    })
    .select()
    .single();

  if (error) return { error: error.message };

  return {
    success: true,
    alert_id: data.id,
    message: `Alert created: "${input.message}" due ${input.due_date}`,
  };
}
