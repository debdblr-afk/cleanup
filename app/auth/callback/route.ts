import { NextResponse } from "next/server";
import { safeNext } from "@/lib/supabase/env";
import { supabaseServer } from "@/lib/supabase/server";

// GET /auth/callback: magic links, email confirmation (including guest -> account) and OAuth land here.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"), "/account");
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const supabase = await supabaseServer();
  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "email" | "magiclink" | "signup" | "email_change" })).error;
  return NextResponse.redirect(new URL(ok ? next : "/login?error=link", url.origin));
}
