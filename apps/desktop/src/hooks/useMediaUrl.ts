import { useCallback, useEffect, useState } from "react";

/**
 * Resolve a media source (image/video) to a displayable URL.
 *
 * Strategy:
 * 1. HTTP/HTTPS URLs → pass through as-is
 * 2. Tauri environment → convertFileSrc() to asset://localhost/ URL
 * 3. Other (dev/browser without Tauri) → return null (unresolvable)
 */
export function useMediaUrl(rawSrc?: string): {
  resolvedUrl: string | null;
  loading: boolean;
  error: boolean;
} {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const resolve = useCallback(async (src: string) => {
    // Already a web URL — use directly
    if (/^https?:\/\//i.test(src)) {
      setResolvedUrl(src);
      setLoading(false);
      setError(false);
      return;
    }

    // Clean up file:// prefix
    const filePath = src.replace(/^file:\/\/+/i, "/");

    // Try Tauri convertFileSrc
    try {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      const assetUrl = convertFileSrc(filePath);
      setResolvedUrl(assetUrl);
      setLoading(false);
      setError(false);
      return;
    } catch {
      // Not in Tauri environment
    }

    // Fallback: unresolvable local path in browser mode
    setResolvedUrl(null);
    setLoading(false);
    setError(true);
  }, []);

  useEffect(() => {
    if (!rawSrc) {
      setResolvedUrl(null);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    void resolve(rawSrc);
  }, [rawSrc, resolve]);

  return { resolvedUrl, loading, error };
}
