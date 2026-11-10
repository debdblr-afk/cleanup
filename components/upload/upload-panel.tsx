"use client";
import { Film, Plus, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { makeSampleClip } from "@/lib/engine/sample";
import { formatBytes, formatDuration } from "@/lib/format";
import { useStore } from "@/lib/data/hooks";
import { addVideos, createBatch, getPlan, hasAttested, liveVideos, setAttested, type Rejection } from "@/lib/data/store";
import { ASK_RIGHTS, BATCH_LIMIT } from "@/lib/plans";
import { Button, Checkbox } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

function rejectionText(r: Rejection, maxBytes: number, maxMs: number): string {
  switch (r.reason) {
    case "too_large": return `${r.filename} is bigger than ${formatBytes(maxBytes)}, the largest file Cleanup takes.`;
    case "unsupported": return `${r.filename} isn't a video we can open. Try MP4, MOV or WebM.`;
    case "batch_full": return `${r.filename} didn't fit: a batch holds ${BATCH_LIMIT} videos. Start a new batch for the rest.`;
    case "too_long": {
      const length = r.durationMs ? ` (${formatDuration(r.durationMs)})` : "";
      return `${r.filename}${length} is longer than ${formatDuration(maxMs)}, the longest video Cleanup takes. Trim it and add it again.`;
    }
    case "no_attestation": return "Tick the box to confirm you have the rights to these videos.";
    case "corrupt": return `${r.filename} couldn't be opened. It may be damaged or in a format this browser can't play.`;
    case "failed": return r.message ?? `${r.filename} couldn't be added. Try again.`;
    default: return `${r.filename} couldn't be read.`;
  }
}

/**
 * Dropzone + rights checkbox (only while ASK_RIGHTS is on) + sample clip. "hero" on S01 creates a batch and goes to it;
 * "tile" on S02 adds to the batch it's given.
 */
export function UploadPanel({ variant, batchId }: { variant: "hero" | "tile"; batchId?: string }) {
  useStore();
  const router = useRouter();
  const inputId = useId();
  const checkId = useId();
  const errId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [attested, setLocalAttested] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sampleProgress, setSampleProgress] = useState<number | null>(null);

  useEffect(() => { setMounted(true); setLocalAttested(hasAttested()); }, []);

  const plan = mounted ? getPlan() : null;
  const left = batchId ? BATCH_LIMIT - liveVideos(batchId).length : BATCH_LIMIT;
  const full = variant === "tile" && left <= 0;

  const attest = (v: boolean) => { setLocalAttested(v); setAttested(v); if (v) setError(null); };

  const handleFiles = useCallback(async (files: File[], source: "upload" | "sample" = "upload") => {
    if (!files.length) return;
    if (!hasAttested()) {
      setError("Tick the box first to confirm you own these videos or have permission to edit them.");
      document.getElementById(checkId)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let target: string;
      try {
        target = batchId ?? (await createBatch()).id;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't start. Try again.");
        return;
      }
      const { added, rejected } = await addVideos(target, files, source);
      const p = getPlan();
      if (rejected.length) {
        const msg = rejectionText(rejected[0], p.maxBytes, p.maxDurationMs) + (rejected.length > 1 ? ` (+${rejected.length - 1} more)` : "");
        if (added.length) toast(msg, "error"); else setError(msg);
      }
      if (added.length && !batchId) router.push(`/b/${target}`);
      else if (added.length) toast(added.length === 1 ? `Added ${added[0].filename}` : `Added ${added.length} videos`);
    } finally {
      setBusy(false);
    }
  }, [batchId, checkId, router]);

  // Paste a video file anywhere on the page while the uploader is showing.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("video/"));
      if (files.length) { e.preventDefault(); void handleFiles(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFiles]);

  const trySample = async () => {
    if (!hasAttested()) attest(true); // our own clip: nothing to attest, but the box records the choice
    setSampleProgress(0);
    try {
      const file = await makeSampleClip(6, setSampleProgress);
      await handleFiles([file], "sample");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a sample clip in this browser.");
    } finally {
      setSampleProgress(null);
    }
  };

  const zoneEvents = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (!full) setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDrag(false); if (!full) void handleFiles(Array.from(e.dataTransfer.files)); },
  };

  const fileInput = (
    <input
      ref={input} id={inputId} type="file" multiple accept="video/*" className="sr-only" disabled={full || busy}
      onChange={(e) => { void handleFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
    />
  );

  const zoneState = drag ? "border-accent border-solid bg-dropzone-active" : error ? "border-danger" : "border-border-input hover:bg-surface";

  if (variant === "tile") {
    return (
      <label
        htmlFor={inputId} {...zoneEvents}
        className={`rounded-xl border-2 border-dashed grid place-items-center text-center p-6 min-h-[240px] transition-colors ${full ? "border-border text-text-muted cursor-not-allowed" : `cursor-pointer ${zoneState}`}`}
      >
        {fileInput}
        <span className="space-y-2">
          <Plus className="mx-auto size-7 text-accent" aria-hidden />
          <span className="block text-sm font-semibold">{drag ? "Drop to add" : full ? "Batch full" : "Add videos"}</span>
          <span className="block text-xs text-text-muted" aria-live="polite">
            {full ? `${BATCH_LIMIT} of ${BATCH_LIMIT} videos. Start a new batch to add more.` : `${left} more fit in this batch`}
          </span>
        </span>
      </label>
    );
  }

  return (
    <div className="space-y-4">
      <div
        {...zoneEvents}
        className={`relative rounded-xl border-2 border-dashed p-6 text-center transition-colors min-h-[340px] lg:min-h-[var(--t-layout-dropzone-hero-h)] grid place-items-center ${zoneState}`}
      >
        {fileInput}
        <div className="flex flex-col items-center gap-3">
          <Film className="size-8 text-accent" aria-hidden />
          <label htmlFor={inputId} className={`cursor-pointer inline-flex items-center gap-2 h-14 px-6 rounded-lg bg-accent text-on-accent text-md font-semibold hover:bg-accent-hover focus-within:outline-2 ${busy ? "opacity-45 pointer-events-none" : ""}`}>
            <Upload className="size-5" aria-hidden /> {drag ? "Drop to upload" : "Upload videos"}
          </label>
          <p className="text-sm text-text-muted">Drag files here or paste with ⌘V</p>
          <p className="text-xs text-text-muted tabnums">
            MP4, MOV, WebM{plan ? ` · up to ${formatBytes(plan.maxBytes)} and ${formatDuration(plan.maxDurationMs)}` : ""} · {BATCH_LIMIT} at once
          </p>
          <div className="mt-2 pt-4 border-t border-border w-full max-w-[260px]">
            <Button variant="ghost" size="sm" onClick={trySample} loading={sampleProgress != null} disabled={busy}>
              {sampleProgress == null && <Sparkles className="size-4" aria-hidden />}
              {sampleProgress == null ? "No video handy? Try a sample" : `Making a sample clip… ${sampleProgress}%`}
            </Button>
          </div>
        </div>
      </div>

      {ASK_RIGHTS && (
        <div className="flex gap-3 items-start text-sm">
          <Checkbox id={checkId} checked={attested} onChange={attest} invalid={!!error && !attested} describedBy={error ? errId : undefined} />
          <label htmlFor={checkId}>
            I own these videos or have permission to edit them, and I won&apos;t use Cleanup to remove someone else&apos;s watermark.{" "}
            <Link href="/legal/terms" className="text-accent underline">Terms</Link>
          </label>
        </div>
      )}
      {error && <p id={errId} role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
