"use client";

// SPIKE — THROWAWAY (issue #463). See ./README.md.

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

// react-pdf evaluates pdfjs-dist at module-eval time, which 500s under
// Server-Component SSR — so the viewer body is loaded client-only (ssr: false).
// This file is already a Client Component, so dynamic({ ssr: false }) is allowed
// here (Next 16 rejects ssr: false inside a Server Component). The import path is
// a literal string and dynamic() lives at module top level, as Next requires.
const SpikeDocument = dynamic(() => import("./spike-document"), { ssr: false });

interface Loaded {
  id: number;
  estimateId: string;
  invoiceId: string;
}

export function ViewerSpikeClient() {
  const [estimateId, setEstimateId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [disableRangeStream, setDisableRangeStream] = useState(true);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const targets = useMemo(() => {
    if (!loaded) return [] as { label: string; url: string }[];
    const out: { label: string; url: string }[] = [];
    const est = loaded.estimateId.trim();
    const inv = loaded.invoiceId.trim();
    if (est) out.push({ label: `Estimate ${est}`, url: `/api/estimates/${est}/preview` });
    if (inv) out.push({ label: `Invoice ${inv}`, url: `/api/invoices/${inv}/preview` });
    return out;
  }, [loaded]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
        PDF viewer reliability spike — #463
      </h1>
      <p style={{ color: "#555", lineHeight: 1.5 }}>
        Throwaway. Open this page in <strong>Chrome</strong> and <strong>Edge</strong> on Windows,
        paste an estimate id and an invoice id from your org (the UUID in the{" "}
        <code>/estimates/&lt;id&gt;</code> / <code>/invoices/&lt;id&gt;</code> URL), and confirm both
        render in continuous scroll without hanging on “Loading PDF…”. Details + the go/no-go record
        are in <code>README.md</code> in this folder.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", margin: "16px 0" }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
          Estimate id
          <input
            value={estimateId}
            onChange={(e) => setEstimateId(e.target.value)}
            placeholder="estimate UUID"
            style={{ width: 320, padding: 6 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, gap: 4 }}>
          Invoice id
          <input
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
            placeholder="invoice UUID"
            style={{ width: 320, padding: 6 }}
          />
        </label>
        <button
          onClick={() =>
            setLoaded((prev) => ({ id: (prev?.id ?? 0) + 1, estimateId, invoiceId }))
          }
          style={{ padding: "8px 16px", fontWeight: 600, cursor: "pointer" }}
        >
          Load
        </button>
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 8, lineHeight: 1.4 }}>
        <input
          type="checkbox"
          checked={disableRangeStream}
          onChange={(e) => setDisableRangeStream(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <code>disableStream</code> + <code>disableRange</code> — the recommended mitigation, since the{" "}
          <code>/preview</code> routes return no <code>Accept-Ranges</code>. Untick to compare the
          default Range-negotiating behavior, then press <strong>Load</strong> again.
        </span>
      </label>

      {targets.length === 0 ? (
        <p style={{ color: "#999" }}>Enter at least one id and press Load.</p>
      ) : (
        targets.map((t) => (
          <SpikeDocument
            key={`${loaded?.id}:${t.url}`}
            label={t.label}
            pdfUrl={t.url}
            disableRangeStream={disableRangeStream}
          />
        ))
      )}
    </div>
  );
}
