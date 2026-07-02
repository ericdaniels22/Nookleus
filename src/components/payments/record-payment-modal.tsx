"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Source = "insurance" | "homeowner" | "other";
type Method = "check" | "ach" | "venmo_zelle" | "cash" | "credit_card";

export default function RecordPaymentModal({
  open,
  onOpenChange,
  invoiceId,
  jobId,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId?: string;
  jobId: string;
  onRecorded?: () => void;
}) {
  const [source, setSource] = useState<Source>("insurance");
  const [method, setMethod] = useState<Method>("check");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [payerName, setPayerName] = useState("");
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSource("insurance");
      setMethod("check");
      setAmount("");
      setReference("");
      setPayerName("");
      setReceivedDate(new Date().toISOString().slice(0, 10));
      setNotes("");
    }
  }, [open]);

  async function submit() {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("Enter an amount");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        invoiceId: invoiceId ?? null,
        source,
        method,
        amount: amt,
        referenceNumber: reference || null,
        payerName: payerName || null,
        receivedDate: new Date(receivedDate).toISOString(),
        notes: notes || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Record failed");
      return;
    }
    toast.success("Payment recorded · QB sync queued");
    onOpenChange(false);
    onRecorded?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Source
              <select
                className="mt-1 w-full border border-border rounded-lg px-2 py-2 bg-background"
                value={source}
                onChange={(e) => setSource(e.target.value as Source)}
              >
                <option value="insurance">Insurance</option>
                <option value="homeowner">Homeowner</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-sm">
              Method
              <select
                className="mt-1 w-full border border-border rounded-lg px-2 py-2 bg-background"
                value={method}
                onChange={(e) => setMethod(e.target.value as Method)}
              >
                <option value="check">Check</option>
                <option value="ach">ACH</option>
                <option value="venmo_zelle">Venmo / Zelle</option>
                <option value="cash">Cash</option>
                <option value="credit_card">Credit card</option>
              </select>
            </label>
          </div>
          <label className="text-sm block">
            Amount
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Reference
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Check #, auth code"
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
              />
            </label>
            <label className="text-sm">
              Payer name
              <input
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
              />
            </label>
          </div>
          <label className="text-sm block">
            Received
            <input
              type="date"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
            />
          </label>
          <label className="text-sm block">
            Notes
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
            />
          </label>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Record
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
