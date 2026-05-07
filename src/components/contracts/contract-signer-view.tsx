"use client";

import { useState } from "react";
import { toast } from "sonner";
import PdfCanvas from "./pdf-canvas";
import SignaturePadModal from "./signature-pad-modal";
import type { PublicSigningView } from "@/lib/contracts/types";

interface Props {
  view: PublicSigningView;
  signToken: string;
  inPerson?: boolean;
  onSigned?: (result: { all_signed: boolean }) => void;
}

export default function ContractSignerView({ view, signToken, inPerson, onSigned }: Props) {
  const [customerInputs, setCustomerInputs] = useState<Record<string, string | boolean>>({});
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [signaturePadOpen, setSignaturePadOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const myFields = view.template.overlay_fields.filter(
    (f) => f.type !== "signature" || f.signerOrder === view.signer.signer_order,
  );

  const requiredMissing = myFields.some((f) => {
    if (f.type === "input" && f.required && !customerInputs[f.inputKey ?? ""]) return true;
    if (f.type === "checkbox" && f.required && customerInputs[f.inputKey ?? ""] !== true) return true;
    if (
      f.type === "signature" &&
      f.signerOrder === view.signer.signer_order &&
      !signatureDataUrl
    )
      return true;
    return false;
  });

  async function submit() {
    setSubmitting(true);
    try {
      const url = inPerson ? "/api/contracts/in-person" : `/api/sign/${signToken}`;
      const body = inPerson
        ? {
            contract_id: view.contract.id,
            signer_id: view.signer.id,
            customer_inputs: customerInputs,
            signature_data_url: signatureDataUrl,
          }
        : {
            customer_inputs: customerInputs,
            signature_data_url: signatureDataUrl,
          };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(
          j.error === "missing_required" ? "Please fill all required fields" : (j.error ?? "Submit failed"),
        );
        return;
      }
      onSigned?.({ all_signed: !!j.all_signed });
    } finally {
      setSubmitting(false);
    }
  }

  if (!view.template.pdf_url) {
    if (view.contract.legacy_html) {
      return (
        <div
          className="prose max-w-none p-8"
          dangerouslySetInnerHTML={{ __html: view.contract.legacy_html }}
        />
      );
    }
    return <div className="p-8 text-muted-foreground">No PDF available.</div>;
  }

  return (
    <>
      <PdfCanvas
        pdfUrl={view.template.pdf_url}
        pdfPages={view.template.pdf_pages ?? []}
        overlayFields={view.template.overlay_fields}
        renderOverlay={({ fields, scale }) => (
          <>
            {fields.map((f) => {
              const style: React.CSSProperties = {
                position: "absolute",
                left: f.x * scale,
                top: f.y * scale,
                width: f.width * scale,
                height: f.height * scale,
              };
              if (f.type === "merge") {
                const value = view.resolved_merge_values[f.mergeFieldName ?? ""] ?? "";
                return (
                  <span
                    key={f.id}
                    style={{
                      ...style,
                      fontSize: f.fontSize * scale,
                      lineHeight: `${f.height * scale}px`,
                    }}
                    className="px-0.5 truncate"
                  >
                    {value}
                  </span>
                );
              }
              if (f.type === "label") {
                return (
                  <span
                    key={f.id}
                    style={{
                      ...style,
                      fontSize: f.fontSize * scale,
                      lineHeight: `${f.fontSize * 1.2 * scale}px`,
                      whiteSpace: "pre-line",
                    }}
                  >
                    {f.labelText}
                  </span>
                );
              }
              if (f.type === "date") {
                return (
                  <span
                    key={f.id}
                    style={{
                      ...style,
                      fontSize: f.fontSize * scale,
                      lineHeight: `${f.height * scale}px`,
                    }}
                  >
                    {new Date().toLocaleDateString("en-US")}
                  </span>
                );
              }
              if (f.type === "input") {
                return (
                  <input
                    key={f.id}
                    style={{ ...style, fontSize: f.fontSize * scale }}
                    className="px-1 border border-amber-400 bg-amber-50 rounded"
                    value={(customerInputs[f.inputKey ?? ""] as string) ?? ""}
                    onChange={(e) =>
                      setCustomerInputs((prev) => ({ ...prev, [f.inputKey ?? ""]: e.target.value }))
                    }
                  />
                );
              }
              if (f.type === "checkbox") {
                return (
                  <input
                    key={f.id}
                    type="checkbox"
                    style={style}
                    checked={customerInputs[f.inputKey ?? ""] === true}
                    onChange={(e) =>
                      setCustomerInputs((prev) => ({ ...prev, [f.inputKey ?? ""]: e.target.checked }))
                    }
                  />
                );
              }
              if (f.type === "signature") {
                const isMine = f.signerOrder === view.signer.signer_order;
                if (!isMine) {
                  const other = view.other_signers.find((s) => s.signer_order === f.signerOrder);
                  return (
                    <div
                      key={f.id}
                      style={style}
                      className="border-2 border-dashed border-zinc-300 bg-zinc-50/80 text-xs text-zinc-500 flex items-center justify-center"
                    >
                      {other?.signed_at ? "Signed" : "Awaiting other signer"}
                    </div>
                  );
                }
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSignaturePadOpen(true)}
                    style={style}
                    className="border-2 border-dashed border-purple-400 bg-purple-50 hover:bg-purple-100 text-xs text-purple-800 flex items-center justify-center"
                  >
                    {signatureDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={signatureDataUrl} alt="signature" className="w-full h-full object-contain" />
                    ) : (
                      "Tap to sign"
                    )}
                  </button>
                );
              }
              return null;
            })}
          </>
        )}
      />
      <div className="sticky bottom-0 inset-x-0 bg-card border-t border-border p-4 flex justify-between items-center">
        <span className="text-sm text-muted-foreground">
          {requiredMissing ? "Fill all required fields and sign to submit" : "Ready to submit"}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={requiredMissing || submitting}
          className="px-4 py-2 rounded bg-[var(--brand-primary)] text-white font-medium disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit signed contract"}
        </button>
      </div>
      <SignaturePadModal
        open={signaturePadOpen}
        onClose={() => setSignaturePadOpen(false)}
        onConfirm={(dataUrl) => setSignatureDataUrl(dataUrl)}
        title={`Sign as ${view.signer.role_label ?? view.signer.name}`}
      />
    </>
  );
}
