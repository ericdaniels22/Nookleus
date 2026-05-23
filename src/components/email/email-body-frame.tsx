"use client";

import { useEffect, useRef, useState } from "react";

// Sandboxed iframe for rendering an email's HTML body. Scripts are disabled
// (no `allow-scripts` in sandbox); links open in a new tab via `<base target>`.
// Shared by the inbox reader and the Job View email row so paragraph spacing
// and inline formatting render identically in both surfaces (#212).
export function EmailBodyFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const baseStyles = `
      :root { color-scheme: light; }
      html, body { margin: 0; padding: 0; background: #fff; color: #333;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px; line-height: 1.5; word-wrap: break-word; }
      img { max-width: 100%; height: auto; }
      a { color: #2B5EA7; }
      table { max-width: 100%; }
    `;

    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>${baseStyles}</style></head><body>${html}</body></html>`);
    doc.close();

    const resize = () => {
      if (!doc.body) return;
      setHeight(doc.body.scrollHeight + 16);
    };
    resize();
    const obs = new ResizeObserver(resize);
    if (doc.body) obs.observe(doc.body);
    return () => obs.disconnect();
  }, [html]);

  return (
    <iframe
      ref={ref}
      title="Email body"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ width: "100%", height, border: 0, display: "block" }}
    />
  );
}
