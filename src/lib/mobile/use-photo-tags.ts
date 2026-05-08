"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import type { PhotoTag } from "@/lib/types";

interface UsePhotoTagsResult {
  tags: PhotoTag[];
  loading: boolean;
  error: string | null;
}

export function usePhotoTags(): UsePhotoTagsResult {
  const [tags, setTags] = useState<PhotoTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data, error: fetchError } = await supabase
          .from("photo_tags")
          .select("id, name, color, created_by, created_at")
          .order("name");
        if (cancelled) return;
        if (fetchError) {
          setError(fetchError.message);
          setTags([]);
        } else {
          setTags(data ?? []);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setTags([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { tags, loading, error };
}
