"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface TrashConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentNumber: string;
  documentKind: "estimate" | "invoice";
  onConfirm: (reason: string | null) => Promise<void>;
  isTrashing: boolean;
}

export function TrashConfirmDialog({
  open,
  onOpenChange,
  documentNumber,
  documentKind,
  onConfirm,
  isTrashing,
}: TrashConfirmDialogProps) {
  const [reason, setReason] = useState("");

  async function handleConfirm() {
    const r = reason.trim() || null;
    await onConfirm(r);
    setReason("");
  }

  return (
    <Dialog open={open} onOpenChange={isTrashing ? undefined : onOpenChange}>
      <DialogContent showCloseButton={!isTrashing}>
        <DialogHeader>
          <DialogTitle>
            Move {documentKind} {documentNumber} to trash?
          </DialogTitle>
          <DialogDescription>
            It will be permanently deleted in 30 days. You can restore it before
            then.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="trash-reason">Reason (optional)</Label>
          <Input
            id="trash-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. duplicate, customer cancelled, …"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isTrashing) void handleConfirm();
              if (e.key === "Escape" && !isTrashing) onOpenChange(false);
            }}
            disabled={isTrashing}
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isTrashing}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={isTrashing}
          >
            {isTrashing ? "Moving…" : "Move to Trash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
