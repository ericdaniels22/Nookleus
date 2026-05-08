"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export interface ConvertConfirmModalProps {
  open: boolean;
  onClose: () => void;
  estimateNumber: string;
  jobNumber: string;
  /** Returned by API on 409 — present when retry hits already-converted. */
  alreadyConvertedTo?: { id: string; number: string } | null;
  onConfirm: () => Promise<void>;
}

export default function ConvertConfirmModal({
  open,
  onClose,
  estimateNumber,
  jobNumber,
  alreadyConvertedTo,
  onConfirm,
}: ConvertConfirmModalProps) {
  if (alreadyConvertedTo) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Already converted</DialogTitle>
          </DialogHeader>
          <p>This estimate has already been converted to <strong>{alreadyConvertedTo.number}</strong>.</p>
          <DialogFooter>
            <a href={`/invoices/${alreadyConvertedTo.id}`} className="btn btn-primary">Go to invoice →</a>
            <button onClick={onClose} className="btn">Cancel</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert this estimate to an invoice?</DialogTitle>
        </DialogHeader>
        <ul className="text-sm space-y-1 list-disc pl-5">
          <li>Creates new invoice <strong>{jobNumber}-INV-?</strong></li>
          <li>Copies sections, line items, markup, discount, tax, and statements</li>
          <li>Marks <strong>{estimateNumber}</strong> as Converted (read-only)</li>
          <li>Redirects you to the new invoice (still editable)</li>
        </ul>
        <DialogFooter>
          <button onClick={onClose} className="btn">Cancel</button>
          <button onClick={() => { void onConfirm(); }} className="btn btn-primary">Convert to Invoice</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
