import "server-only";
import { z } from "zod";
import { ACCEPTED_TYPES } from "@/lib/plans";

export const uuid = z.string().uuid();

const region = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["erase", "protect"]),
  shape: z.enum(["rect", "brush"]).default("rect"),
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(600).optional(),
  size: z.number().min(0.002).max(0.5).optional(),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  w: z.number().min(0.005).max(1), h: z.number().min(0.005).max(1),
  tStartMs: z.number().int().min(0),
  tEndMs: z.number().int().min(0).nullable(),
  track: z.boolean(),
  source: z.enum(["user", "auto"]),
}).refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, "Zone must stay inside the frame")
  .refine((r) => r.tEndMs == null || r.tEndMs >= r.tStartMs, "Zone ends before it starts")
  .refine((r) => r.shape !== "brush" || (r.points && r.size), "A brush zone needs its stroke");

export const mask = z.object({ regions: z.array(region).max(50) });

export const createVideo = z.object({
  batchId: uuid,
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().refine((t) => ACCEPTED_TYPES.includes(t), "Unsupported video type"),
  sizeBytes: z.number().int().positive(),
  source: z.enum(["upload", "sample"]).default("upload"),
  attest: z.literal(true).optional(), // required by the route while ASK_RIGHTS is on
  attestationVersion: z.string().min(1).max(32),
});

export const completeVideo = z.object({
  durationMs: z.number().int().positive().max(24 * 3600 * 1000),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  thumbnail: z.string().startsWith("data:image/jpeg;base64,").max(200_000).nullable(),
});

export const createJob = z.object({
  mode: z.enum(["watermark", "subtitle", "text", "object", "person"]).default("watermark"),
  mask: mask.default({ regions: [] }),
  autoDetect: z.boolean().default(true),
  parentJobId: uuid.nullable().default(null),
});

export const createExport = z.object({ resolution: z.enum(["720p", "1080p", "1440p", "2160p"]) });

export const workerProgress = z.object({
  workerId: z.string().min(8).max(64),
  progress: z.number().int().min(0).max(100),
  status: z.enum(["detecting", "rendering"]).optional(),
  detectedMask: mask.nullable().optional(),
});

export const workerUpload = z.object({ workerId: z.string().min(8).max(64), contentType: z.enum(["video/webm", "video/mp4"]) });

export const workerComplete = z.object({
  workerId: z.string().min(8).max(64),
  ok: z.boolean(),
  durationMs: z.number().int().positive().optional(),
  detectedMask: mask.nullable().optional(),
  errorCode: z.enum(["nothing_found", "render_failed", "unsupported_browser"]).optional(),
  errorMessage: z.string().max(300).optional(),
});

export const checkout = z.object({ plan: z.enum(["plus", "pro"]), interval: z.enum(["month", "year"]) });

export const takedown = z.object({
  reporterName: z.string().trim().min(1).max(200),
  reporterEmail: z.string().trim().email().max(320),
  rightsHolder: z.string().trim().min(1).max(200),
  workDescription: z.string().trim().min(10).max(5000),
  infringingRef: z.string().trim().min(3).max(2000),
  goodFaith: z.literal(true),
  signature: z.string().trim().min(2).max(200),
});
