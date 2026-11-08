// Passcode gate for the whole site. Set SITE_PASSCODE on the server to turn it on; leave it
// unset (local development, tests) and the site is open.
//
// Entering the right passcode sets an http-only cookie holding HMAC(passcode, label), so the
// cookie can't be made without knowing the passcode, and changing the passcode signs everyone
// out. Web Crypto only, so it runs in middleware (edge) and in route handlers alike.

export const GATE_COOKIE = "cleanup_gate";
export const GATE_DAYS = 30;

export function gatePasscode(): string | null {
  const p = process.env.SITE_PASSCODE;
  return p && p.length > 0 ? p : null;
}

export async function gateToken(passcode: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(passcode), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode("cleanup-gate-v1")));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
