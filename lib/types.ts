// Shapes mirror replica-watermark/schema.sql (camelCase here, snake_case there),
// so swapping the fake data layer for Supabase changes no screen code.

export type PlanId = "guest" | "free" | "plus" | "pro";
export type RemovalMode = "watermark" | "subtitle" | "text" | "object" | "person";

/** One zone on the frame. Coordinates are 0..1 of the frame, so they survive any resize. */
export type Region = {
  id: string;
  kind: "erase" | "protect";
  shape: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  tStartMs: number;
  tEndMs: number | null; // null = to the end
  track: boolean;
  source: "user" | "auto";
};

export type Mask = { regions: Region[] };

export type Batch = {
  id: string;
  name: string | null;
  createdAt: string;
  expiresAt: string;
};

export type VideoStatus = "uploading" | "probing" | "ready" | "rejected" | "deleted";
export type RejectReason = "too_long" | "too_large" | "unsupported" | "corrupt";

export type Video = {
  id: string;
  batchId: string;
  position: number;
  source: "upload" | "sample";
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: VideoStatus;
  rejectReason: RejectReason | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  thumbnail: string | null; // small JPEG data URL
  rightsAttestedAt: string;
  attestationVersion: string;
  createdAt: string;
};

export type JobStatus = "queued" | "detecting" | "rendering" | "done" | "failed" | "canceled";

export type Job = {
  id: string;
  videoId: string;
  parentJobId: string | null;
  mode: RemovalMode;
  autoDetect: boolean;
  mask: Mask;
  detectedMask: Mask | null;
  status: JobStatus;
  progress: number; // 0..100
  errorCode: "nothing_found" | "render_failed" | "unsupported_browser" | null;
  errorMessage: string | null;
  previewMs: number | null;
  createdAt: string;
  finishedAt: string | null;
  quotaDate: string;
};

export type ExportStatus = "queued" | "rendering" | "done" | "failed";

export type Export = {
  id: string;
  jobId: string;
  resolution: "720p" | "1080p" | "1440p" | "2160p";
  status: ExportStatus;
  progress: number;
  sizeBytes: number | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
};
