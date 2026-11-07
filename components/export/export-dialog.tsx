"use client";
import { Download, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useFileUrl, useStore } from "@/lib/data/hooks";
import { createExport, exportsFor, getPlan, quotaStatus } from "@/lib/data/store";
import { extensionFor } from "@/lib/engine/video";
import { formatBytes, formatDuration } from "@/lib/format";
import { RESOLUTIONS, resolutionAllowed } from "@/lib/plans";
import type { Export, Job, Video } from "@/lib/types";
import { Dialog } from "@/components/ui/dialog";
import { buttonClass, Button, ProgressBar } from "@/components/ui/primitives";
import { baseName } from "@/components/batch/file-card";

export function ExportDialog({ job, video, open, onOpenChange }: { job: Job | null; video: Video | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  useStore();
  const plan = getPlan();
  const q = quotaStatus();
  const firstAllowed = RESOLUTIONS.find((r) => resolutionAllowed(plan, r.id) && video?.height && r.height <= Math.max(720, video.height))?.id ?? "720p";
  const [res, setRes] = useState<Export["resolution"]>(firstAllowed);
  const [message, setMessage] = useState<string | null>(null);
  const preview = useFileUrl("preview", job?.id, job?.status === "done");
  if (!job || !video) return null;
  const exports = exportsFor(job.id);
  const paid = !!plan.maxResolution;

  const start = async () => {
    setMessage(null);
    const r = await createExport(job.id, res);
    if (r.ok) return;
    if (r.reason === "upgrade") setMessage("That resolution isn't on your plan.");
    else if (r.reason === "busy") setMessage("That export is already running or done. It's listed below.");
    else if (r.reason === "daily_cap") setMessage(`No exports left today. They reset in ${r.resetsInHours} h.`);
    else setMessage("The preview isn't ready yet.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Export video" description={`${video.filename} · full length ${formatDuration(video.durationMs)}`}>
      <fieldset className="grid grid-cols-2 gap-2 text-sm" disabled={!paid}>
        <legend className="sr-only">Resolution</legend>
        {RESOLUTIONS.map((r) => {
          const allowed = resolutionAllowed(plan, r.id);
          const upscale = video.height != null && r.height > Math.max(720, video.height);
          const usable = allowed && !upscale;
          return (
            <label key={r.id} className={`h-12 px-3 rounded-md flex items-center gap-2 ${usable ? (res === r.id ? "border-2 border-accent bg-accent-soft font-semibold cursor-pointer" : "border border-border-input cursor-pointer") : "border border-border text-text-muted"}`}>
              {usable
                ? <input type="radio" name="res" value={r.id} checked={res === r.id} onChange={() => setRes(r.id)} className="accent-[var(--t-color-accent)]" />
                : <Lock className="size-4" aria-hidden />}
              {r.label}
              {!allowed && <span className="text-xs ml-auto">{r.id === "2160p" || r.id === "1440p" ? "Pro" : "Plus"}</span>}
              {allowed && upscale && <span className="text-xs ml-auto">Above source</span>}
            </label>
          );
        })}
      </fieldset>

      {paid ? (
        <p className="text-sm text-text-muted tabnums mt-4">{q.exportsLeft} of {q.exportsCap} exports left today. Exports render in this tab: keep it open until it finishes.</p>
      ) : (
        <div className="mt-4 rounded-lg bg-surface p-4 text-sm">
          <p className="font-semibold">Full-length exports are on Plus and Pro.</p>
          <p className="text-text-muted mt-1">Your free preview covers the first 5 seconds and is yours to download.</p>
          <Link href="/pricing" className={buttonClass("primary", "md", "mt-3")}>See plans</Link>
        </div>
      )}

      {message && <p role="alert" className="text-sm text-danger mt-3">{message}</p>}

      {exports.length > 0 && (
        <ul className="mt-4 space-y-3" aria-label="Exports">
          {exports.map((e) => <ExportRow key={e.id} ex={e} filename={video.filename} />)}
        </ul>
      )}

      <div className="flex flex-wrap justify-end gap-2 mt-6">
        {preview && (
          <a href={preview} download={`${baseName(video.filename)}-cleaned-5s.webm`} className={buttonClass("ghost", "md")}>Download 5 s preview</a>
        )}
        {paid && <Button onClick={start}>Export {RESOLUTIONS.find((r) => r.id === res)?.label}</Button>}
      </div>
    </Dialog>
  );
}

function ExportRow({ ex, filename }: { ex: Export; filename: string }) {
  const url = useFileUrl("result", ex.id, ex.status === "done");
  const label = RESOLUTIONS.find((r) => r.id === ex.resolution)?.label;
  return (
    <li className="text-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label} · full length</span>
        {ex.status === "done" && url ? (
          <a href={url} download={`${baseName(filename)}-cleaned-${ex.resolution}.${extensionFor("video/webm")}`} className={buttonClass("primary", "sm")}>
            <Download className="size-4" aria-hidden /> Download {formatBytes(ex.sizeBytes)}
          </a>
        ) : ex.status === "failed" ? (
          <span className="text-danger text-xs">{ex.errorMessage}</span>
        ) : (
          <span className="text-text-muted text-xs tabnums">{ex.status === "queued" ? "Waiting" : `${ex.progress}%`}</span>
        )}
      </div>
      {(ex.status === "queued" || ex.status === "rendering") && <ProgressBar value={ex.status === "queued" ? null : ex.progress} label={`Exporting ${label}`} size="lg" />}
    </li>
  );
}
