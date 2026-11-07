"use client";
import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Editor } from "@/components/editor/editor";
import { buttonClass, EmptyState, Skeleton } from "@/components/ui/primitives";
import { useStore } from "@/lib/data/hooks";
import { getState } from "@/lib/data/store";

export default function EditPage() {
  const { batchId, videoId } = useParams<{ batchId: string; videoId: string }>();
  const { hydrated } = useStore();
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-page px-4 lg:px-8 py-6" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 aspect-video w-full" />
      </div>
    );
  }
  const video = getState().videos.get(videoId);
  if (!video || video.status === "deleted" || video.batchId !== batchId) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16">
        <EmptyState icon={<Clapperboard />} title="This video isn't here" body="It was removed, it expired, or it was added in another browser."
          action={<Link href={getState().batches.has(batchId) ? `/b/${batchId}` : "/"} className={buttonClass("primary", "md")}>Go back</Link>} />
      </div>
    );
  }
  if (video.status !== "ready") {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16">
        <EmptyState icon={<Clapperboard />} title={video.status === "rejected" ? "This video can't be edited" : "Still reading this video"}
          body={video.status === "rejected" ? "It's too long for your plan or couldn't be opened." : "Give it a moment, then try again."}
          action={<Link href={`/b/${batchId}`} className={buttonClass("primary", "md")}>Back to batch</Link>} />
      </div>
    );
  }
  return <Editor key={video.id} video={video} />;
}
