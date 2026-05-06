"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { getStatusBadgeClasses, formatStatusLabel } from "@/lib/estimate-status";

interface InvoiceRow {
  id: string;
  invoice_number: string;
  title: string;
  status: string;
  total_amount: number;
  issued_date: string;
  due_date: string | null;
  converted_from_estimate_id: string | null;
}

interface InvoicesListProps {
  jobId: string;
  canCreate: boolean;
  canManage?: boolean;
  onTrash?: (row: { id: string; invoice_number: string }) => void;
}

export default function InvoicesList({ jobId, canCreate, canManage, onTrash }: InvoicesListProps) {
  const router = useRouter();
  const [rows, setRows] = useState<InvoiceRow[]>([]);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/invoices?jobId=${jobId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { rows: InvoiceRow[] };
      setRows(data.rows.sort((a, b) => a.invoice_number.localeCompare(b.invoice_number)));
    })();
  }, [jobId]);

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium">Invoices</h3>
        {canCreate && <Link href={`/jobs/${jobId}/invoices/new`} className="btn btn-sm">+ New Invoice</Link>}
      </div>
      {rows.length === 0
        ? <div className="text-xs text-muted-foreground">No invoices yet.</div>
        : (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono">{r.invoice_number}</td>
                  <td>{r.title}</td>
                  <td><span className={`px-2 py-0.5 rounded text-xs ${getStatusBadgeClasses("invoice", r.status)}`}>{formatStatusLabel("invoice", r.status)}</span></td>
                  <td>{r.converted_from_estimate_id && <Link href={`/estimates/${r.converted_from_estimate_id}`} className="text-xs text-blue-600">← from EST</Link>}</td>
                  <td className="text-right">${r.total_amount.toFixed(2)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Link href={`/invoices/${r.id}`} className="text-xs">View</Link>
                      {canManage && onTrash && (
                        <button
                          type="button"
                          onClick={() => onTrash({ id: r.id, invoice_number: r.invoice_number })}
                          className="text-destructive hover:opacity-80 inline-flex items-center"
                          title="Move invoice to trash"
                          aria-label="Move invoice to trash"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </section>
  );
}
