import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkGate, GATE_COOKIE, gateOpen, gatePasscode } from "@/lib/gate";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";

// Refreshes the Supabase session cookie on page and API requests so handlers see a valid user.
export async function middleware(request: NextRequest) {
  const p = request.nextUrl.pathname;

  // Passcode gate: with SITE_PASSCODE set, nothing but the entry page opens without a cookie
  // from the last GATE_HOURS hours.
  const passcode = gatePasscode();
  if (passcode && !gateOpen(p)) {
    const state = await checkGate(passcode, request.cookies.get(GATE_COOKIE)?.value ?? "");
    if (state !== "ok") {
      if (p.startsWith("/api/")) return NextResponse.json({ error: { code: "passcode", message: "Enter the passcode first." } }, { status: 401 });
      const to = request.nextUrl.clone();
      to.pathname = "/enter";
      const q = new URLSearchParams();
      if (p !== "/") q.set("next", p + request.nextUrl.search);
      if (state === "expired") q.set("expired", "1");
      to.search = q.size ? `?${q}` : "";
      return NextResponse.redirect(to);
    }
  }

  let response = NextResponse.next({ request });
  // Cron jobs and the server worker carry their own auth; skip the cookie round trip.
  if (p.startsWith("/api/cron") || p.startsWith("/api/worker/server")) return response;
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
