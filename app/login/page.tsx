"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useId, useState } from "react";
import { Button, buttonClass } from "@/components/ui/primitives";

function LoginForm() {
  const params = useSearchParams();
  const checkout = params.get("next") === "checkout";
  const emailId = useId();
  const errId = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Enter a full email address, like name@example.com."); return; }
    setError(null);
    setNotice(true);
  };

  return (
    <div className="mx-auto max-w-sm px-4 py-16 space-y-4">
      <h1 className="text-xl">{checkout ? "Sign in to upgrade" : "Save your work"}</h1>
      <p className="text-sm text-text-muted">
        {checkout ? "You need an account to pay for a plan." : "Sign in to keep your batches. Anything you've added as a guest stays where it is."}
      </p>
      <Button variant="outline" size="lg" className="w-full text-sm" onClick={() => setNotice(true)}>Continue with Google</Button>
      <div className="flex items-center gap-3 text-xs text-text-muted"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
      <form onSubmit={submit} noValidate className="space-y-3">
        <div>
          <label htmlFor={emailId} className="text-sm font-medium">Email</label>
          <input
            id={emailId} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error || undefined} aria-describedby={error ? errId : undefined}
            className={`mt-1 w-full h-12 px-3 rounded-md border bg-bg text-base focus:outline-2 focus:outline-focus focus:outline-offset-0 ${error ? "border-danger" : "border-border-input"}`}
          />
          {error && <p id={errId} className="text-xs text-danger mt-1">{error}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full text-sm">Email me a link</Button>
      </form>
      {notice && (
        <div role="status" className="rounded-lg bg-warning-soft text-warning p-4 text-sm">
          Accounts aren&apos;t switched on in this preview yet. You&apos;re using a guest session, and your videos are saved in this browser.{" "}
          <Link href="/account" className="underline">Try a plan in demo mode</Link>
        </div>
      )}
      <Link href="/" className={buttonClass("ghost", "sm")}>Back to the uploader</Link>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
