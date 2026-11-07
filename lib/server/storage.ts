import "server-only";
// File storage, behind one small interface with two back ends:
// - "supabase" (default): Supabase Storage. Used locally with the Docker stack.
// - "s3": any S3-compatible store; Cloudflare R2 online (free 10 GB, files up to 5 GB in
//   one upload, no download fees). Set STORAGE_PROVIDER=s3 and the S3_* variables.
// Same keys and the same signed-URL flow either way: browsers and the worker PUT to a
// one-time URL and read through short-lived links, so the bucket stays private.
import {
  DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MEDIA_BUCKET } from "@/lib/supabase/env";
import { supabaseAdmin } from "@/lib/supabase/server";

export const keys = {
  prefix: (user: string, video?: string) => (video ? `u/${user}/${video}/` : `u/${user}/`),
  original: (user: string, video: string) => `u/${user}/${video}/original`,
  thumb: (user: string, video: string) => `u/${user}/${video}/thumb.jpg`,
  preview: (user: string, video: string, job: string) => `u/${user}/${video}/preview-${job}`,
  result: (user: string, video: string, exp: string) => `u/${user}/${video}/export-${exp}`,
};

/** A one-time upload: PUT the file to `url` with exactly these headers. */
export type SignedUpload = { url: string; headers: Record<string, string> };

const s3Mode = () => process.env.STORAGE_PROVIDER === "s3";
const bucketName = () => process.env.S3_BUCKET || MEDIA_BUCKET;

let client: S3Client | null = null;
function s3(): S3Client {
  if (client) return client;
  const { S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new Error("STORAGE_PROVIDER=s3 needs S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: process.env.S3_REGION || "auto", // R2 wants "auto"
    forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    // Don't add checksum headers to presigned URLs: browsers wouldn't send them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

const sb = () => supabaseAdmin().storage.from(MEDIA_BUCKET);

/** `attachment` with the name kept readable in any language (RFC 6266 / 5987). */
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** One-time upload URL for a path. Lives 2 hours. */
export async function signedUpload(path: string, contentType: string): Promise<SignedUpload> {
  if (s3Mode()) {
    const url = await getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucketName(), Key: path, ContentType: contentType }), { expiresIn: 7200 });
    return { url, headers: { "content-type": contentType } };
  }
  const { data, error } = await sb().createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw error ?? new Error("no upload url");
  return { url: data.signedUrl, headers: { "content-type": contentType, "x-upsert": "true" } };
}

/** Short-lived read URL. `download` sets the saved filename (Content-Disposition: attachment). */
export async function signedRead(path: string, ttlSeconds = 600, download?: string): Promise<string> {
  if (s3Mode()) {
    return getSignedUrl(s3(), new GetObjectCommand({
      Bucket: bucketName(), Key: path, ...(download ? { ResponseContentDisposition: attachment(download) } : {}),
    }), { expiresIn: ttlSeconds });
  }
  const { data, error } = await sb().createSignedUrl(path, ttlSeconds, download ? { download } : undefined);
  if (error || !data) throw error ?? new Error("no read url");
  return data.signedUrl;
}

/** Size and type of a stored file, or null when it isn't there. */
export async function stat(path: string): Promise<{ size: number; type: string } | null> {
  if (s3Mode()) {
    try {
      const h = await s3().send(new HeadObjectCommand({ Bucket: bucketName(), Key: path }));
      return { size: Number(h.ContentLength ?? 0), type: h.ContentType ?? "" };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (e as Error).name === "NotFound") return null;
      throw e;
    }
  }
  const i = path.lastIndexOf("/");
  const { data, error } = await sb().list(path.slice(0, i), { search: path.slice(i + 1), limit: 10 });
  if (error) throw error;
  const f = data?.find((x) => x.name === path.slice(i + 1));
  if (!f || !f.metadata) return null;
  return { size: Number(f.metadata.size ?? 0), type: String(f.metadata.mimetype ?? "") };
}

export async function putBytes(path: string, bytes: Uint8Array, contentType: string) {
  if (s3Mode()) {
    await s3().send(new PutObjectCommand({ Bucket: bucketName(), Key: path, Body: bytes, ContentType: contentType }));
    return;
  }
  const { error } = await sb().upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}

/** Delete everything under a prefix (one video, or a whole user). Returns how many files went. */
export async function removePrefix(prefix: string): Promise<number> {
  const dir = prefix.replace(/\/$/, "");
  if (s3Mode()) {
    let removed = 0;
    let token: string | undefined;
    do {
      const page = await s3().send(new ListObjectsV2Command({ Bucket: bucketName(), Prefix: `${dir}/`, ContinuationToken: token }));
      const objects = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (objects.length) {
        await s3().send(new DeleteObjectsCommand({ Bucket: bucketName(), Delete: { Objects: objects, Quiet: true } }));
        removed += objects.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }
  const paths: string[] = [];
  const walk = async (d: string) => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await sb().list(d, { limit: 100, offset });
      if (error) throw error;
      if (!data?.length) break;
      for (const f of data) {
        const p = `${d}/${f.name}`;
        if (f.id == null) await walk(p); // folder
        else paths.push(p);
      }
      if (data.length < 100) break;
    }
  };
  await walk(dir);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await sb().remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
  return paths.length;
}
