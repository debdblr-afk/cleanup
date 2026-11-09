import { NextResponse } from "next/server";
import { db, fail, isResponse, requireUser } from "@/lib/server/http";
import { uuid } from "@/lib/server/schemas";
import { signedRead, stat } from "@/lib/server/storage";

// GET /api/files?kind=original|thumb|preview|result&id=...[&download=name]
// Ownership check, then a redirect to a 10-minute signed URL. Files are never public.
export async function GET(req: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id") ?? "";
  const download = url.searchParams.get("download")?.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || undefined;
  if (!uuid.safeParse(id).success) return fail(404, "not_found", "No such file.");

  let path: string | null = null;
  if (kind === "original" || kind === "thumb") {
    const { data } = await db().from("videos").select("user_id, status, original_key, thumbnail_key").eq("id", id).single<{ user_id: string; status: string; original_key: string; thumbnail_key: string | null }>();
    if (data && data.user_id === user.id && data.status !== "deleted") path = kind === "original" ? data.original_key : data.thumbnail_key;
  } else if (kind === "preview") {
    const { data } = await db().from("removal_jobs").select("user_id, preview_key").eq("id", id).single<{ user_id: string; preview_key: string | null }>();
    if (data && data.user_id === user.id) path = data.preview_key;
  } else if (kind === "result") {
    const { data } = await db().from("exports").select("user_id, result_key").eq("id", id).single<{ user_id: string; result_key: string | null }>();
    if (data && data.user_id === user.id) path = data.result_key;
  }
  if (!path) return fail(404, "not_found", "No such file.");
  let signed: string;
  try {
    // Name the download after what's stored: Safari records MP4, other browsers WebM.
    let name = download;
    if (name && (kind === "preview" || kind === "result")) {
      const type = (await stat(path))?.type ?? "";
      const ext = type.includes("mp4") ? "mp4" : type.includes("webm") ? "webm" : null;
      if (ext) name = name.replace(/\.(webm|mp4)$/i, "") + "." + ext;
    }
    signed = await signedRead(path, 600, name);
  } catch {
    // The file is gone (removed or expired) though its record remains: "not found", not a crash.
    return fail(404, "not_found", "No such file.");
  }
  return NextResponse.redirect(signed, { status: 302, headers: { "cache-control": "private, no-store" } });
}
