// Passcode gate for the whole site. Set SITE_PASSCODE on the server to turn it on; leave it
// unset (local development, tests) and the site is open.
//
// Entering the right passcode sets an http-only cookie "<time entered>.<HMAC(passcode, time)>".
// It can't be made or re-dated without knowing the passcode, it stops working GATE_HOURS after
// it was issued (even if a browser keeps the cookie), and changing the passcode signs everyone
// out. Web Crypto only, so it runs in middleware (edge) and in route handlers alike.

export const GATE_COOKIE = "cleanup_gate";
/** Hours a passcode entry lasts before it has to be entered again. */
export const GATE_HOURS = 6;

export function gatePasscode(): string | null {
  const p = process.env.SITE_PASSCODE;
  return p && p.length > 0 ? p : null;
}

async function sign(passcode: string, issuedSec: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(passcode), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`cleanup-gate-v2:${issuedSec}`)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** The cookie value for a passcode entered at `issuedSec` (default: now). */
export async function gateToken(passcode: string, issuedSec = nowSec()): Promise<string> {
  return `${issuedSec}.${await sign(passcode, issuedSec)}`;
}

/** "ok" while the cookie is genuine and under GATE_HOURS old, "expired" when genuine but older, else "bad". */
export async function checkGate(passcode: string, value: string, now = nowSec()): Promise<"ok" | "expired" | "bad"> {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m) return "bad";
  const issued = Number(m[1]);
  if (!sameString(m[2], await sign(passcode, issued))) return "bad";
  if (issued > now + 60) return "bad"; // dated in the future
  return now - issued < GATE_HOURS * 3600 ? "ok" : "expired";
}

/** Constant-time string comparison (the lengths may differ). */
export function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Paths that never need the passcode: the entry page itself, machine-to-machine routes, and link-preview assets. */
export function gateOpen(path: string): boolean {
  return (
    path === "/enter" ||
    path === "/api/enter" ||
    path.startsWith("/api/cron") || // Vercel Cron, protected by CRON_SECRET
    path.startsWith("/api/worker/server") || // the optional server worker, protected by WORKER_SECRET
    path === "/icon.svg" ||
    path.startsWith("/opengraph-image")
  );
}
