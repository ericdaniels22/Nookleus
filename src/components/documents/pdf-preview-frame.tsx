// Inline PDF preview frame (#385). Embeds a server-rendered, customer-facing
// document PDF via the browser's native viewer, so the View surface shows the
// real PDF — exactly what the customer receives — rather than an HTML
// re-render. Purely presentational (no hooks/events), so it is safe to render
// from either a Server Component (estimate View) or a Client Component
// (invoice View). `src` points at the `/preview` route that streams the PDF
// inline.

interface PdfPreviewFrameProps {
  src: string;
  title: string;
}

export function PdfPreviewFrame({ src, title }: PdfPreviewFrameProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      <iframe src={src} title={title} className="w-full h-[80vh]" />
    </div>
  );
}
