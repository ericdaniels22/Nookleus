"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { JobActivity } from "@/lib/types";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  MessageSquare,
  Camera,
  Flag,
  Shield,
  Wrench,
  Receipt,
  Plus,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Expense, ExpenseCategory, Vendor } from "@/lib/types";
import ReceiptDetailModal from "@/components/expenses/receipt-detail-modal";

const activityTypeConfig: Record<
  string,
  { icon: React.ComponentType<{ size?: number; className?: string }>; color: string; label: string }
> = {
  note: { icon: MessageSquare, color: "bg-vibrant-blue", label: "Note" },
  photo: { icon: Camera, color: "bg-primary", label: "Photo" },
  milestone: { icon: Flag, color: "bg-vibrant-red", label: "Milestone" },
  insurance: { icon: Shield, color: "bg-vibrant-purple", label: "Insurance" },
  equipment: { icon: Wrench, color: "bg-vibrant-amber", label: "Equipment" },
  expense: { icon: Receipt, color: "bg-[#27500A]", label: "Expense" },
};

type ExpenseWithRelations = Expense & { vendor?: Vendor | null; category?: ExpenseCategory | null };

const activityTypes = [
  { value: "note", label: "Note" },
  { value: "milestone", label: "Milestone" },
  { value: "insurance", label: "Insurance" },
  { value: "equipment", label: "Equipment" },
  { value: "photo", label: "Photo" },
];

export default function ActivityTimeline({
  activities,
  jobId,
  onActivityAdded,
}: {
  activities: JobActivity[];
  jobId: string;
  onActivityAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activityType, setActivityType] = useState("note");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<ExpenseWithRelations | null>(null);

  async function handleActivityClick(activityId: string, activity_type: string) {
    if (activity_type !== "expense") return;
    const res = await fetch(`/api/expenses/by-activity/${activityId}`);
    if (!res.ok) { toast.error("Could not load receipt"); return; }
    const expense = (await res.json()) as ExpenseWithRelations;
    setSelectedExpense(expense);
    setReceiptOpen(true);
  }

  async function handleAddActivity() {
    if (!title.trim()) {
      toast.error("Please enter a title.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const { error } = await supabase.from("job_activities").insert({
      organization_id: await getActiveOrganizationId(supabase),
      job_id: jobId,
      activity_type: activityType,
      title: title.trim(),
      description: description.trim() || null,
      author: "Eric",
    });

    if (error) {
      toast.error("Failed to add activity.");
    } else {
      toast.success("Activity added.");
      setTitle("");
      setDescription("");
      setActivityType("note");
      setOpen(false);
      onActivityAdded();
    }
    setSubmitting(false);
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">
          Activity Log
        </h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
          >
            <Plus size={16} className="mr-1" />
            Add Note
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Activity</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Type
                </label>
                <div className="flex flex-wrap gap-2">
                  {activityTypes.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setActivityType(opt.value)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium border transition-all",
                        activityType === opt.value
                          ? "bg-accent-tint text-accent-text border-transparent"
                          : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:shadow-sm"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Title
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Brief summary..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1.5">
                  Details (optional)
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Full details..."
                  rows={3}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  variant="gradient"
                  onClick={handleAddActivity}
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Add"
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {activities.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 py-4 text-center">
          No activity yet.
        </p>
      ) : (
        <div className="relative">
          {/* Gradient vertical line */}
          <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/30 to-transparent" />

          <div className="space-y-4">
            {activities.map((activity) => {
              const config =
                activityTypeConfig[activity.activity_type] ||
                activityTypeConfig.note;
              const Icon = config.icon;

              const isExpense = activity.activity_type === "expense";
              const InnerWrapper: React.ElementType = isExpense ? "button" : "div";
              return (
                <InnerWrapper
                  key={activity.id}
                  onClick={isExpense ? () => handleActivityClick(activity.id, activity.activity_type) : undefined}
                  className={cn(
                    "w-full text-left flex gap-3 relative",
                    isExpense && "hover:bg-accent/30 rounded-lg -mx-1 px-1 py-0.5 cursor-pointer",
                  )}
                >
                  <div
                    className={cn(
                      "w-[30px] h-[30px] rounded-full flex items-center justify-center flex-shrink-0 z-10 shadow-sm",
                      config.color
                    )}
                  >
                    <Icon size={14} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {activity.title}
                      </p>
                      <span className="text-xs text-muted-foreground/60 flex-shrink-0">
                        {format(
                          new Date(activity.created_at),
                          "MMM d, h:mm a"
                        )}
                      </span>
                    </div>
                    {activity.description && (
                      <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">
                        {activity.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {activity.author}
                    </p>
                  </div>
                </InnerWrapper>
              );
            })}
          </div>
        </div>
      )}
      <ReceiptDetailModal
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        expense={selectedExpense}
        onChanged={() => { onActivityAdded(); setReceiptOpen(false); }}
      />
    </div>
  );
}
