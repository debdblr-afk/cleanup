"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { fileUrl, getState, getVersion, hydrate, subscribe } from "./store";

/** Re-render on every store change; read whatever you need from getState() / the selectors. */
export function useStore(): { hydrated: boolean; version: number } {
  useEffect(() => { void hydrate(); }, []);
  const version = useSyncExternalStore(subscribe, getVersion, () => 0);
  return { hydrated: getState().hydrated, version };
}

/** Object URL for a stored file, or null while loading / when missing. */
export function useFileUrl(kind: "original" | "preview" | "result", id: string | null | undefined, ready = true): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!id || !ready) { setUrl(null); return; }
    void fileUrl(kind, id).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [kind, id, ready]);
  return url;
}
