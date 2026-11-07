"use client";
import { useEffect, useSyncExternalStore } from "react";
import { fileUrl, getState, getVersion, hydrate, subscribe } from "./store";

/** Re-render on every store change; read whatever you need from getState() / the selectors. */
export function useStore(): { hydrated: boolean; version: number } {
  useEffect(() => { void hydrate(); }, []);
  const version = useSyncExternalStore(subscribe, getVersion, () => 0);
  // Through the snapshot, so a Suspense boundary that hydrates after the store has loaded
  // still renders what the server sent first (false), then updates.
  const hydrated = useSyncExternalStore(subscribe, () => getState().hydrated, () => false);
  return { hydrated, version };
}

/** URL for a stored file (redirects to a short-lived signed URL), or null when not ready. */
export function useFileUrl(kind: "original" | "preview" | "result", id: string | null | undefined, ready = true, download?: string): string | null {
  return id && ready ? fileUrl(kind, id, download) : null;
}
