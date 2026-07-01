"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import {
  Dialog, DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Image as ImageIcon, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Expense, ExpenseCategory, PaymentMethod, Vendor } from "@/lib/types";
import { PAYMENT_METHODS } from "@/lib/expenses-constants";
import VendorAutocomplete from "./vendor-autocomplete";
import { prepareReceiptUploads } from "./image-utils";

type VendorWithCategory = Vendor & { default_category?: ExpenseCategory | null };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  jobId: string;
  existing?: (Expense & { vendor?: Vendor | null; category?: ExpenseCategory | null }) | null;
  onSaved: () => void;
}

export default function LogExpenseModal({ open, onOpenChange, jobId, existing, onSaved }: Props) {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [keepExistingReceipt, setKeepExistingReceipt] = useState<boolean>(Boolean(existing?.receipt_path));
  const [vendor, setVendor] = useState<VendorWithCategory | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("business_card");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/settings/expense-categories");
    if (res.ok) setCategories(await res.json());
  }, []);

  useEffect(() => { if (open) loadCategories(); }, [open, loadCategories]);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setVendor((existing.vendor ?? null) as VendorWithCategory | null);
      setAmount(existing.amount.toFixed(2));
      setDate(existing.expense_date);
      setCategoryId(existing.category_id);
      setPaymentMethod(existing.payment_method);
      setDescription(existing.description ?? "");
      setKeepExistingReceipt(Boolean(existing.receipt_path));
    } else {
      setVendor(null);
      setAmount("");
      setDate(new Date().toISOString().slice(0, 10));
      setCategoryId("");
      setPaymentMethod("business_card");
      setDescription("");
      setKeepExistingReceipt(false);
    }
    setFile(null);
    setPreview(null);
  }, [open, existing]);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setFile(f);
    e.target.value = "";
  }

  function handleVendorChange(v: VendorWithCategory | null) {
    setVendor(v);
    if (v?.default_category_id && !categoryId) setCategoryId(v.default_category_id);
  }

  function validate(): string | null {
    if (!vendor) return "Select or add a vendor";
    if (!amount || Number(amount) <= 0) return "Enter a valid amount";
    if (!date) return "Pick a date";
    if (!categoryId) return "Pick a category";
    if (!paymentMethod) return "Pick a payment method";
    return null;
  }

  async function uploadReceipt(): Promise<{ receipt_path: string | null; thumbnail_path: string | null }> {
    if (!file) return { receipt_path: null, thumbnail_path: null };
    const supabase = createClient();
    const uuid = crypto.randomUUID();
    const receiptPath = `${jobId}/${uuid}.jpg`;
    const thumbPath = `${jobId}/${uuid}.thumb.jpg`;
    const { original, thumbnail } = await prepareReceiptUploads(file);

    const upA = await supabase.storage.from("receipts").upload(receiptPath, original.blob, { contentType: "image/jpeg" });
    if (upA.error) throw new Error(upA.error.message);
    const upB = await supabase.storage.from("receipts").upload(thumbPath, thumbnail.blob, { contentType: "image/jpeg" });
    if (upB.error) {
      await supabase.storage.from("receipts").remove([receiptPath]);
      throw new Error(upB.error.message);
    }
    return { receipt_path: receiptPath, thumbnail_path: thumbPath };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { toast.error(err); return; }
    if (!vendor) return;

    setSubmitting(true);
    try {
      let receiptPath: string | null = keepExistingReceipt ? (existing?.receipt_path ?? null) : null;
      let thumbPath: string | null = keepExistingReceipt ? (existing?.thumbnail_path ?? null) : null;

      if (file) {
        const uploaded = await uploadReceipt();
        receiptPath = uploaded.receipt_path;
        thumbPath = uploaded.thumbnail_path;
      }

      const body = {
        job_id: jobId,
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        category_id: categoryId,
        amount: Number(Number(amount).toFixed(2)),
        expense_date: date,
        payment_method: paymentMethod,
        description: description || null,
        receipt_path: receiptPath,
        thumbnail_path: thumbPath,
      };

      let res: Response;
      if (existing) {
        const qs = new URLSearchParams();
        if (existing.receipt_path && existing.receipt_path !== receiptPath) qs.set("old_receipt", existing.receipt_path);
        if (existing.thumbnail_path && existing.thumbnail_path !== thumbPath) qs.set("old_thumb", existing.thumbnail_path);
        res = await fetch(`/api/expenses/${existing.id}${qs.toString() ? `?${qs}` : ""}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/expenses", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        // Roll back storage upload if we just wrote one
        if (!existing && receiptPath && thumbPath) {
          const supabase = createClient();
          await supabase.storage.from("receipts").remove([receiptPath, thumbPath]);
        }
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? "Failed to save expense");
      }

      toast.success(existing ? "Expense updated" : "Expense logged");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save expense");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "p-0 overflow-hidden flex flex-col",
          "max-w-full h-dvh max-h-dvh inset-0 translate-x-0 translate-y-0 rounded-none top-0 left-0", // mobile
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-lg sm:h-[min(90vh,720px)] sm:rounded-xl", // desktop: fixed height so inner flex can scroll
        )}
      >
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h2 className="text-lg font-semibold text-foreground">{existing ? "Edit Expense" : "Log Expense"}</h2>
            <button type="button" onClick={() => onOpenChange(false)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
            {/* Receipt photo */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Receipt</label>
              {preview || (keepExistingReceipt && existing?.thumbnail_path) ? (
                <div className="rounded-xl border border-border overflow-hidden bg-accent/30 flex items-center gap-3 p-3">
                  {preview
                    ? <img src={preview} alt="" className="w-20 h-20 object-cover rounded-lg" />
                    : <ReceiptPreviewFromServer expenseId={existing!.id} />}
                  <div className="flex-1">
                    <p className="text-sm text-foreground font-medium">
                      {file?.name ?? "Attached receipt"}
                    </p>
                    {file && <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>}
                    <div className="flex gap-2 mt-1">
                      <button type="button" onClick={() => libraryInputRef.current?.click()}
                        className="text-xs text-primary hover:underline">Replace</button>
                      <button type="button" onClick={() => { setFile(null); setKeepExistingReceipt(false); }}
                        className="text-xs text-muted-foreground hover:text-destructive">Remove</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => cameraInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 py-4 rounded-xl border-2 border-dashed border-border text-sm font-medium text-foreground hover:border-primary hover:bg-primary/5">
                    <Camera size={18} /> Take Photo
                  </button>
                  <button type="button" onClick={() => libraryInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 py-4 rounded-xl border-2 border-dashed border-border text-sm font-medium text-foreground hover:border-primary hover:bg-primary/5">
                    <ImageIcon size={18} /> Choose from Library
                  </button>
                </div>
              )}
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
              <input ref={libraryInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            </div>

            {/* Vendor */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Vendor</label>
              <VendorAutocomplete value={vendor} onChange={handleVendorChange} />
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">$</span>
                <Input inputMode="decimal" value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  onBlur={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n) && n > 0) setAmount(n.toFixed(2)); }}
                  placeholder="0.00"
                  className="pl-7 h-11 text-base" />
              </div>
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 text-base" />
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Category</label>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <button key={c.id} type="button" onClick={() => setCategoryId(c.id)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
                    style={categoryId === c.id
                      ? { backgroundColor: c.bg_color, color: c.text_color, borderColor: "transparent" }
                      : { backgroundColor: "transparent", color: "#8A9199", borderColor: "rgba(255,255,255,0.08)" }}>
                    {c.display_label}
                  </button>
                ))}
              </div>
            </div>

            {/* Payment method */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Payment Method</label>
              <div className="flex flex-wrap gap-1.5">
                {PAYMENT_METHODS.map((p) => (
                  <button key={p.value} type="button" onClick={() => setPaymentMethod(p.value)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      paymentMethod === p.value
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-transparent text-[#8A9199] border-[rgba(255,255,255,0.08)] hover:text-foreground",
                    )}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Description (optional)</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-base" />
            </div>
          </div>

          <div className="border-t border-border px-5 py-3 flex justify-end gap-2 bg-card shrink-0">
            <button type="button" onClick={() => onOpenChange(false)}
              className="px-4 h-11 rounded-lg text-sm text-muted-foreground hover:bg-accent">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="px-5 h-11 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-2">
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {existing ? "Save Changes" : "Log Expense"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptPreviewFromServer({ expenseId }: { expenseId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/expenses/${expenseId}/thumbnail-url`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j.url) setUrl(j.url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [expenseId]);
  if (!url) return <div className="w-20 h-20 rounded-lg bg-accent" />;
  return <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg" />;
}
