"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useState } from "react";
import { Button, buttonClass } from "@/components/ui/primitives";
import { useStore } from "@/lib/data/hooks";
import { getState } from "@/lib/data/store";
import { safeNext, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/env";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginForm() {
  useStore();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), "/account");
  const checkout = next.startsWith("/pricing");
  const emailId = useId();
  const errId = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(params.get("error") === "link" ? "That link has expired or was already used. Ask for a new one." : null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [googleOn, setGoogleOn] = useState(false);
  useEffect(() => setMounted(true), []);
  // Only offer Google when the provider is switched on; otherwise its button leads to a raw error page.
  useEffect(() => {
    fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setGoogleOn(!!s?.external?.google))
      .catch(() => {});
  }, []);

  const profile = mounted ? getState().profile : null;
  const guest = !!profile?.isAnonymous;
  const redirect = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const submit = async (e: React.FormEvent, forceSignIn = false) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Enter a full email address, like name@example.com."); return; }
    setError(null);
    setBusy(true);
    const sb = supabaseBrowser();
    try {
      if (guest && !forceSignIn) {
        // Keep the guest's batches: attach the email to the same account.
        const { error: err } = await sb.auth.updateUser({ email }, { emailRedirectTo: redirect() });
        if (err) {
          if (/already|registered|exists/i.test(err.message)) { setExisting(true); return; }
          throw err;
        }
      } else {
        const { error: err } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect(), shouldCreateUser: true } });
        if (err) throw err;
      }
      setSentTo(email);
    } catch (err) {
      setError(err instanceof Error && /rate|seconds/i.test(err.message) ? "Too many tries. Wait a minute and try again." : "Couldn't send the email. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    const sb = supabaseBrowser();
    const opts = { provider: "google" as const, options: { redirectTo: redirect() } };
    const { error: err } = guest ? await sb.auth.linkIdentity(opts) : await sb.auth.signInWithOAuth(opts);
    if (err) setError(/not enabled|unsupported provider/i.test(err.message) ? "Google sign-in isn't set up yet. Use your email for now." : "Couldn't start Google sign-in.");
  };

  if (sentTo) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 space-y-4" role="status">
        <h1 className="text-xl">Check your inbox</h1>
        <p className="text-sm text-text-muted">We sent a link to <strong className="text-text">{sentTo}</strong>. Open it on this device to finish{guest ? ". Your videos stay with you." : "."}</p>
        <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>Use a different email</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16 space-y-4">
      <h1 className="text-xl">{checkout ? "Sign in to choose a plan" : guest ? "Save your work" : "Sign in"}</h1>
      <p className="text-sm text-text-muted">
        {checkout ? "Plans are tied to an account so you can manage or cancel them any time." : guest ? "Add your email to keep your batches. Everything you've added as a guest stays where it is." : "We'll email you a link. No password needed."}
      </p>
      {googleOn && (
        <>
          <Button variant="outline" size="lg" className="w-full text-sm" onClick={google}>Continue with Google</Button>
          <div className="flex items-center gap-3 text-xs text-text-muted"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
        </>
      )}
      <form onSubmit={submit} noValidate className="space-y-3">
        <div>
          <label htmlFor={emailId} className="text-sm font-medium">Email</label>
          <input
            id={emailId} type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setExisting(false); }}
            aria-invalid={!!error || undefined} aria-describedby={error ? errId : undefined}
            className={`mt-1 w-full h-12 px-3 rounded-md border bg-bg text-base focus:outline-2 focus:outline-focus focus:outline-offset-0 ${error ? "border-danger" : "border-border-input"}`}
          />
          {error && <p id={errId} role="alert" className="text-xs text-danger mt-1">{error}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full text-sm" loading={busy}>Email me a link</Button>
      </form>
      {existing && (
        <div role="alert" className="rounded-lg bg-warning-soft text-warning p-4 text-sm space-y-2">
          <p>That email already has an account. Signing in to it switches accounts, and the videos you added as a guest stay with the guest session.</p>
          <Button size="sm" variant="outline" onClick={(e) => submit(e as unknown as React.FormEvent, true)}>Sign in to that account</Button>
        </div>
      )}
      <Link href="/" className={buttonClass("ghost", "sm")}>Back to the uploader</Link>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
