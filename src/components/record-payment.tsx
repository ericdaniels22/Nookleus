"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { getActiveOrganizationId } from "@/lib/supabase/get-active-org";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  resolvePaymentSourceBadge,
  resolvePaymentStatusBadge,
} from "@/lib/badge-colors";
import { Loader2, DollarSign } from "lucide-react";
import { toast } from "sonner";

// §2.6 tints come from the shared resolvers so the selector pills match the
// source/status badges rendered on the Billing card (#917).
const paymentSources = [
  { value: "insurance", label: "Insurance" },
  { value: "homeowner", label: "Homeowner" },
  { value: "other", label: "Other" },
];

const paymentMethods = [
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH" },
  { value: "venmo_zelle", label: "Venmo / Zelle" },
  { value: "cash", label: "Cash" },
  { value: "credit_card", label: "Credit Card" },
];

const paymentStatuses = [
  { value: "received", label: "Received" },
  { value: "pending", label: "Pending" },
  { value: "due", label: "Due" },
];

export default function RecordPaymentModal({
  open,
  onOpenChange,
  jobId,
  onPaymentAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  onPaymentAdded: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [source, setSource] = useState("insurance");
  const [method, setMethod] = useState("check");
  const [status, setStatus] = useState("received");
  const [amount, setAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [referenceNumber, setReferenceNumber] = useState("");
  const [payerName, setPayerName] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setSource("insurance");
    setMethod("check");
    setStatus("received");
    setAmount("");
    setReceivedDate(new Date().toISOString().split("T")[0]);
    setReferenceNumber("");
    setPayerName("");
    setNotes("");
  }

  async function handleSubmit() {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error("Please enter a valid amount.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const { error } = await supabase.from("payments").insert({
      organization_id: await getActiveOrganizationId(supabase),
      job_id: jobId,
      source,
      method,
      status,
      amount: parseFloat(amount),
      received_date: receivedDate || null,
      reference_number: referenceNumber || null,
      payer_name: payerName || null,
      notes: notes || null,
    });

    if (error) {
      toast.error("Failed to record payment.");
      console.error(error);
    } else {
      toast.success(
        `Payment of $${parseFloat(amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} recorded.`
      );
      reset();
      onOpenChange(false);
      onPaymentAdded();
    }
    setSubmitting(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pt-2">
          {/* Source */}
          <div>
            <Label>Payment Source</Label>
            <PillSelector
              options={paymentSources}
              value={source}
              onChange={setSource}
              selectedColor={resolvePaymentSourceBadge}
            />
          </div>

          {/* Method */}
          <div>
            <Label>Payment Method</Label>
            <PillSelector
              options={paymentMethods}
              value={method}
              onChange={setMethod}
            />
          </div>

          {/* Status */}
          <div>
            <Label>Status</Label>
            <PillSelector
              options={paymentStatuses}
              value={status}
              onChange={setStatus}
              selectedColor={resolvePaymentStatusBadge}
            />
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Amount</Label>
              <div className="relative">
                <DollarSign
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  min="0"
                  className="pl-8"
                />
              </div>
            </div>
            <div>
              <Label>Date Received</Label>
              <Input
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                type="date"
              />
            </div>
          </div>

          {/* Reference + Payer */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Check / Reference #</Label>
              <Input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="Check #, transaction ID..."
              />
            </div>
            <div>
              <Label>Payer Name</Label>
              <Input
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder="Who sent it?"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context about this payment..."
              rows={2}
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-lg text-sm font-medium px-6 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Record Payment
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-muted-foreground mb-1.5">
      {children}
    </label>
  );
}

function PillSelector({
  options,
  value,
  onChange,
  selectedColor,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (val: string) => void;
  selectedColor?: (value: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium border border-transparent transition-all",
              isSelected
                ? selectedColor
                  ? selectedColor(opt.value)
                  : "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
