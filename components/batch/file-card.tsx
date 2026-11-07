"use client";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Download, Ellipsis, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useStore, useFileUrl } from "@/lib/data/hooks";
import { cancelJob, createJob, getPlan, latestJob, queuePosition, quotaStatus, removeVideo, retryJob, uploadStalled } from "@/lib/data/store";
import { formatBytes, formatDuration, formatResolution, ordinal } from "@/lib/format";
import type { Job, Video } from "@/lib/types";
import { buttonClass, Button, ProgressBar, StatusBadge } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { BeforeAfter } from "./before-after";

export function baseName(filename: string) {
  return filename.replace(/\.[^.]+$/, "") || "video";
}

export function FileCard({ video, onExport }: { video: Video; onExport: (job: Job) => void }) {
  useStore();
  const job = latestJob(video.id);
  const editHref = `/b/${video.batchId}/${video.id}/edit`;
  const done = job?.status === "done";
  const original = useFileUrl("original", video.id, done);
  const preview = useFileUrl("preview", job?.id, done);
  const previewDownload = useFileUrl("preview", job?.id, done, `${baseName(video.filename)}-cleaned-5s.webm`);

  const meta = [formatDuration(video.durationMs), formatResolution(video.height), formatBytes(video.sizeBytes)].filter(Boolean).join(" · ");

  const [retrying, setRetrying] = useState(false);
  const startAgain = async (j: Job) => {
    if (retrying) return;
    setRetrying(true);
    try {
      const r = await retryJob(j.id);
      if (!r.ok && r.reason === "daily_cap") toast(`No previews left today. They reset in ${r.resetsInHours} h.`, "error");
      else if (!r.ok && r.reason === "refused") toast(`Couldn't start it again: ${r.message}`, "error");
    } finally {
      setRetrying(false);
    }
  };

  const remove = async () => { await removeVideo(video.id); toast(`Removed ${video.filename}`); };

  let body: React.ReactNode;
  if (uploadStalled(video)) {
    body = (
      <>
        <StatusBadge tone="danger">Upload stopped</StatusBadge>
        <p className="text-xs text-text-muted">The upload didn&apos;t finish, maybe because the page was closed or refreshed. Remove it and add the file again.</p>
        <Button size="sm" variant="outline" className="w-fit" onClick={remove}>Remove</Button>
      </>
    );
  } else if (video.status === "uploading" || video.status === "probing") {
    body = (<><ProgressBar value={null} label={`Reading ${video.filename}`} /><p className="text-xs text-text-muted">{video.status === "uploading" ? "Saving the file" : "Reading the video"}</p></>);
  } else if (video.status === "rejected") {
    const plan = getPlan();
    body = video.rejectReason === "too_long"
      ? (<><StatusBadge tone="warning">Too long</StatusBadge><p className="text-xs text-text-muted">Videos can be up to {formatDuration(plan.maxDurationMs)}. Trim it and add it again.</p></>)
      : (<><StatusBadge tone="danger">Can&apos;t open</StatusBadge><p className="text-xs text-text-muted">This file couldn&apos;t be read. It may be damaged or use a format this browser can&apos;t play.</p></>);
  } else if (!job) {
    const q = quotaStatus();
    body = (
      <>
        <StatusBadge tone="warning">Not cleaned yet</StatusBadge>
        <p className="text-xs text-text-muted">{q.previewsLeft === 0 ? `No previews left today. They reset in ${q.resetsInHours} h.` : "Ready when you are."}</p>
        {q.previewsLeft > 0 && <Button size="sm" variant="outline" onClick={async () => { await createJob(video.id, { autoDetect: true }); }}>Clean it</Button>}
      </>
    );
  } else if (job.status === "queued") {
    const n = queuePosition(job.id);
    body = (
      <div className="flex items-center justify-between gap-2">
        <StatusBadge>Waiting{n > 1 ? ` · ${ordinal(n)} in line` : ""}</StatusBadge>
        <button className="text-xs font-semibold underline" onClick={() => cancelJob(job.id)}>Cancel</button>
      </div>
    );
  } else if (job.status === "detecting") {
    body = (<><ProgressBar value={null} label="Finding the watermark" /><p className="text-xs text-text-muted">Finding the watermark</p></>);
  } else if (job.status === "rendering") {
    body = (
      <>
        <ProgressBar value={job.progress} label="Cleaning the preview" />
        <div className="flex justify-between text-xs">
          <span className="text-text-muted tabnums">Cleaning the 5 s preview · {job.progress}%</span>
          <button className="font-semibold underline" onClick={() => cancelJob(job.id)}>Cancel</button>
        </div>
      </>
    );
  } else if (done) {
    body = (
      <>
        <StatusBadge tone="success">Preview ready</StatusBadge>
        <div className="flex gap-2">
          <Link href={editHref} className={buttonClass("outline", "sm")}>Edit</Link>
          {previewDownload && (
            <a href={previewDownload} download className={buttonClass("outline", "sm")} aria-label={`Download 5 second preview of ${video.filename}`}>
              <Download className="size-4" aria-hidden />
            </a>
          )}
          <Button size="sm" className="ml-auto" onClick={() => onExport(job)}>Export</Button>
        </div>
      </>
    );
  } else if (job.errorCode === "nothing_found") {
    body = (
      <>
        <StatusBadge tone="warning">No watermark found</StatusBadge>
        <p className="text-xs text-text-muted">Draw a box over it and we&apos;ll clean that spot. This didn&apos;t use up a preview.</p>
        <Link href={editHref} className={buttonClass("outline", "sm", "w-fit")}>Mark it yourself</Link>
      </>
    );
  } else {
    body = (
      <>
        <StatusBadge tone={job.status === "canceled" ? "neutral" : "danger"}>{job.status === "canceled" ? "Canceled" : "Failed"}</StatusBadge>
        {job.errorMessage && <p className="text-xs text-text-muted">{job.errorMessage}</p>}
        <Button size="sm" variant="outline" className="w-fit" loading={retrying} onClick={() => startAgain(job)}>Try again</Button>
      </>
    );
  }

  return (
    <article aria-labelledby={`v-${video.id}`} className={`bg-surface-raised border border-border rounded-xl shadow-card hover:shadow-raised transition-shadow overflow-hidden flex flex-col ${done ? "ring-2 ring-accent/0" : ""}`}>
      {done && original && preview ? (
        <BeforeAfter beforeVideo={original} afterVideo={preview} rounded="rounded-none" limitS={5} />
      ) : (
        <div className="relative aspect-video bg-canvas">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {video.thumbnail && <img src={video.thumbnail} alt="" className="absolute inset-0 size-full object-contain" />}
        </div>
      )}
      <div className="p-3 space-y-2 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 id={`v-${video.id}`} className="text-sm font-semibold truncate" title={video.filename}>{video.filename}</h3>
            <p className="text-xs text-text-muted tabnums">{meta || " "}</p>
          </div>
          <Menu.Root>
            <Menu.Trigger className="size-8 -mr-1 grid place-items-center rounded-md hover:bg-surface-hover" aria-label={`More actions for ${video.filename}`}>
              <Ellipsis className="size-4" aria-hidden />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="end" sideOffset={4} className="z-40 w-52 bg-surface-raised border border-border rounded-lg shadow-pop py-1 text-sm">
                {video.status === "ready" && (
                  <Menu.Item asChild>
                    <Link href={editHref} className="w-full h-9 px-3 flex items-center gap-2 outline-none data-[highlighted]:bg-surface-hover"><Pencil className="size-4" aria-hidden />Edit zones</Link>
                  </Menu.Item>
                )}
                <Menu.Item
                  onSelect={remove}
                  className="w-full h-9 px-3 flex items-center gap-2 text-danger outline-none data-[highlighted]:bg-danger-soft cursor-pointer"
                >
                  <Trash2 className="size-4" aria-hidden />Remove from batch
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <div aria-live="polite" className="space-y-2">{body}</div>
      </div>
    </article>
  );
}
