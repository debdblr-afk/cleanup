import { NextResponse } from "next/server";
import { z } from "zod";
import { GATE_COOKIE, GATE_DAYS, gatePasscode, gateToken, sameString } from "@/lib/gate";

// POST /api/enter { passcode }: checks the site passcode and sets the gate cookie.
export async function POST(req: Request) {
  const passcode = gatePasscode();
  if (!passcode) return NextResponse.json({ ok: true }); // gate off (local development)
  const parsed = z.object({ passcode: z.string().max(200) }).safeParse(await req.json().catch(() => null));
  const given = parsed.success ? parsed.data.passcode.trim() : "";
  if (!sameString(given, passcode)) {
    await new Promise((r) => setTimeout(r, 600)); // slows down guessing
    return NextResponse.json({ error: { code: "wrong_passcode", message: "That passcode isn't right." } }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, await gateToken(passcode), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: GATE_DAYS * 86_400,
  });
  return res;
}
