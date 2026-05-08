"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { SendModal } from "./index";

export type SendButtonProps =
  | {
      mode: "estimate";
      documentId: string;
      jobId: string;
      status: string; // EstimateStatus value
    }
  | {
      mode: "invoice";
      documentId: string;
      jobId: string;
      status: string; // InvoiceStatus value
    };

export function SendButton(props: SendButtonProps) {
  const { mode, documentId, jobId, status } = props;
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { hasPermission } = useAuth();

  const permissionKey =
    mode === "estimate" ? "manage_estimates" : "manage_invoices";
  const canManage = hasPermission(permissionKey);

  const blockedStatuses =
    mode === "estimate" ? ["voided", "converted"] : ["voided"];
  const disabled = blockedStatuses.includes(status);

  if (!canManage) return null;

  const tooltip = disabled
    ? `Cannot send a ${status} ${mode}.`
    : undefined;

  return (
    <>
      <Button
        size="sm"
        variant="default"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={tooltip}
      >
        <Send size={14} className="mr-1.5" />
        Send
      </Button>
      <SendModal
        open={open}
        onOpenChange={setOpen}
        mode={mode}
        documentId={documentId}
        jobId={jobId}
        onSent={() => router.refresh()}
      />
    </>
  );
}
