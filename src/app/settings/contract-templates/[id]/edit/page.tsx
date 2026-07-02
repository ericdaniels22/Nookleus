"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import TemplatePdfEditor from "@/components/contracts/template-pdf-editor";
import type { ContractTemplate } from "@/lib/contracts/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ContractTemplateEditPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { hasPermission, loading: authLoading } = useAuth();
  const allowed = hasPermission("manage_contract_templates");

  const [template, setTemplate] = useState<ContractTemplate | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!authLoading && allowed) {
      (async () => {
        const res = await fetch(`/api/settings/contract-templates/${id}`);
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          toast.error("Failed to load template");
          return;
        }
        const data = (await res.json()) as ContractTemplate;
        setTemplate(data);
      })();
    }
  }, [authLoading, allowed, id]);

  if (authLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 size={20} className="inline animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <Lock size={28} className="mx-auto text-muted-foreground mb-3" />
        <h2 className="text-lg font-semibold text-foreground">Access restricted</h2>
        <p className="text-sm text-muted-foreground mt-1">
          You don&apos;t have permission to edit contract templates.
        </p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold text-foreground">Template not found</h2>
        <p className="text-sm text-muted-foreground mt-1">
          This template may have been deleted.
        </p>
        <Link
          href="/settings/contract-templates"
          className="inline-flex items-center gap-1 mt-4 text-sm text-accent-text hover:underline"
        >
          <ArrowLeft size={14} /> Back to templates
        </Link>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 size={20} className="inline animate-spin mr-2" /> Loading template…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <button
          type="button"
          onClick={() => router.push("/settings/contract-templates")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> Templates
        </button>
        <span className="text-xs text-muted-foreground">v{template.version}</span>
      </div>
      <TemplatePdfEditor initial={template} />
    </div>
  );
}
