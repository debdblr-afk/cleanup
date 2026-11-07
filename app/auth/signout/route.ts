import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// POST /auth/signout?scope=global signs out every device; default is this one.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") === "global" ? "global" : "local";
  await (await supabaseServer()).auth.signOut({ scope });
  return NextResponse.redirect(new URL("/", url.origin), { status: 303 });
}
