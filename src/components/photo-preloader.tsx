"use client";

import { useEffect } from "react";
import { preload } from "react-dom";

/**
 * Fire-and-forget, low-priority prefetch of a list of image URLs (#395).
 *
 * Renders nothing: it runs {@link preload} from an effect (after paint) so the
 * Job page never waits on it, and `fetchPriority: "low"` keeps these previews
 * behind everything the page actually needs to load first. The browser dedupes
 * the prefetch against the grid's later `<img>` request for the same URL, so
 * the Photos tab opens already warm.
 */
export default function PhotoPreloader({ urls }: { urls: string[] }) {
  useEffect(() => {
    urls.forEach((url) => preload(url, { as: "image", fetchPriority: "low" }));
  }, [urls]);

  return null;
}
