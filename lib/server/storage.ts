import "server-only";
// File storage. Supabase Storage today (local and hosted). Moving to Cloudflare R2
// (architecture.md) means rewriting only this file: same keys, same signed-URL calls.
import { MEDIA_BUCKET } from "@/lib/supabase/env";
import { supabaseAdmin } from "@/lib/supabase/server";

const bucket = () => supabaseAdmin().storage.from(MEDIA_BUCKET);

export const keys = {
  prefix: (user: string, video?: string) => (video ? `u/${user}/${video}/` : `u/${user}/`),
  original: (user: string, video: string) => `u/${user}/${video}/original`,
  thumb: (user: string, video: string) => `u/${user}/${video}/thumb.jpg`,
  preview: (user: string, video: string, job: string) => `u/${user}/${video}/preview-${job}`,
  result: (user: string, video: string, exp: string) => `u/${user}/${video}/export-${exp}`,
};

/** One-time upload token for a path; the browser PUTs the file straight to storage. */
export async function signedUpload(path: string) {
  const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw error ?? new Error("no upload url");
  return { path: data.path, token: data.token };
}

/** Short-lived read URL. `download` sets the saved filename (Content-Disposition: attachment). */
export async function signedRead(path: string, ttlSeconds = 600, download?: string) {
  const { data, error } = await bucket().createSignedUrl(path, ttlSeconds, download ? { download } : undefined);
  if (error || !data) throw error ?? new Error("no read url");
  return data.signedUrl;
}

/** Size and type of a stored file, or null when it isn't there. */
export async function stat(path: string): Promise<{ size: number; type: string } | null> {
  const i = path.lastIndexOf("/");
  const { data, error } = await bucket().list(path.slice(0, i), { search: path.slice(i + 1), limit: 10 });
  if (error) throw error;
  const f = data?.find((x) => x.name === path.slice(i + 1));
  if (!f || !f.metadata) return null;
  return { size: Number(f.metadata.size ?? 0), type: String(f.metadata.mimetype ?? "") };
}

export async function putBytes(path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await bucket().upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
}

/** Delete everything under a prefix (one video, or a whole user). */
export async function removePrefix(prefix: string): Promise<number> {
  const paths: string[] = [];
  const walk = async (dir: string) => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket().list(dir, { limit: 100, offset });
      if (error) throw error;
      if (!data?.length) break;
      for (const f of data) {
        const p = `${dir}/${f.name}`;
        if (f.id == null) await walk(p); // folder
        else paths.push(p);
      }
      if (data.length < 100) break;
    }
  };
  await walk(prefix.replace(/\/$/, ""));
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket().remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
  return paths.length;
}
