"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ForceDeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentNumber: string;
  documentKind: "estimate" | "invoice";
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

export function ForceDeleteConfirmDialog({
  open,
  onOpenChange,
  documentNumber,
  documentKind,
  onConfirm,
  isDeleting,
}: ForceDeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={isDeleting ? undefined : onOpenChange}>
      <DialogContent showCloseButton={!isDeleting}>
        <DialogHeader>
          <DialogTitle>
            Permanently delete {documentKind} {documentNumber}?
          </DialogTitle>
          <DialogDescription>
            This cannot be undone. The PDF will also be removed from storage.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
