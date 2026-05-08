"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface VoidConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  entityLabel: string;
}

export function VoidConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  entityLabel,
}: VoidConfirmDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
    }
  }, [open]);

  const canConfirm = reason.trim().length > 0;
  const remaining = 500 - reason.length;

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm(reason.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>Void this {entityLabel}?</DialogTitle>
          <DialogDescription>
            Voiding is irreversible. The {entityLabel} will be marked as voided and
            no further edits will be allowed. Please provide a reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Textarea
            autoFocus
            rows={3}
            placeholder="Reason for voiding…"
            value={reason}
            onChange={(e) => {
              if (e.target.value.length <= 500) setReason(e.target.value);
            }}
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onOpenChange(false);
              }
            }}
          />
          <p
            className={`text-xs text-right ${
              remaining <= 50 ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {remaining} characters remaining
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            Void {entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
