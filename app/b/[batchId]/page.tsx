"use client";
import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { FileCard } from "@/components/batch/file-card";
import { ExportDialog } from "@/components/export/export-dialog";
import { QuotaMeter } from "@/components/shell/shell";
import { buttonClass, EmptyState, Skeleton } from "@/components/ui/primitives";
import { UploadPanel } from "@/components/upload/upload-panel";
import { useStore } from "@/lib/data/hooks";
import { getState, liveVideos } from "@/lib/data/store";
import { BATCH_LIMIT } from "@/lib/plans";
import type { Job } from "@/lib/types";

export default function BatchPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const { hydrated } = useStore();
  const [exportJob, setExportJob] = useState<Job | null>(null);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-page px-4 lg:px-8 py-8" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <div className="mt-6 grid gap-4 grid-cols-[repeat(auto-fill,minmax(var(--t-layout-card-min),1fr))]">
          {[0, 1, 2].map((i) => <div key={i} className="space-y-2"><Skeleton className="aspect-video" /><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>)}
        </div>
      </div>
    );
  }

  const batch = getState().batches.get(batchId);
  if (!batch) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16">
        <EmptyState
          icon={<Clapperboard />} title="This batch isn't here"
          body="It may have expired or been removed, or it was made in another browser. Videos stay in the browser that added them, for 7 days."
          action={<Link href="/" className={buttonClass("primary", "md")}>Start a new batch</Link>}
        />
      </div>
    );
  }

  const videos = liveVideos(batchId);
  const exportVideo = exportJob ? getState().videos.get(exportJob.videoId) ?? null : null;
  const created = new Date(batch.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-page px-4 lg:px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl">Batch from {created}</h1>
          <p className="text-sm text-text-muted tabnums">{videos.length} of {BATCH_LIMIT} videos · kept until {new Date(batch.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</p>
        </div>
        {/* The header shows the meter from md up. */}
        <div className="md:hidden"><QuotaMeter /></div>
      </div>

      {videos.length === 0 ? (
        <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <EmptyState icon={<Clapperboard />} title="No videos yet" body={`Add up to ${BATCH_LIMIT} videos and we'll clean them side by side.`} />
          <UploadPanel variant="tile" batchId={batchId} />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,var(--t-layout-card-min)),1fr))]">
          {videos.map((v) => <FileCard key={v.id} video={v} onExport={setExportJob} />)}
          <UploadPanel variant="tile" batchId={batchId} />
        </div>
      )}

      <ExportDialog key={exportJob?.id ?? "none"} job={exportJob} video={exportVideo} open={!!exportJob} onOpenChange={(o) => !o && setExportJob(null)} />
    </div>
  );
}
