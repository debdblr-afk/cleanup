"use client";
import { Lock } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useId, useState } from "react";
import { Button } from "@/components/ui/primitives";

/** Only same-site paths, so the redirect after entering can't send anyone elsewhere. */
function safeNext(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/enter") ? v : "/";
}

function EnterForm() {
  const params = useSearchParams();
  const inputId = useId();
  const errId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) { setError("Enter the passcode."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: code }) });
      if (res.ok) { window.location.replace(safeNext(params.get("next"))); return; }
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "That passcode isn't right.");
    } catch {
      setError("Couldn't check the passcode. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm px-4 py-20">
      <div className="mx-auto mb-5 size-12 rounded-xl bg-surface border border-border grid place-items-center text-accent" aria-hidden><Lock className="size-6" /></div>
      <h1 className="text-xl text-center">Enter the passcode</h1>
      <p className="text-sm text-text-muted text-center mt-2">Cleanup is private for now.</p>
      <form onSubmit={submit} noValidate className="mt-6 space-y-3">
        <div>
          <label htmlFor={inputId} className="text-sm font-medium">Passcode</label>
          <input
            id={inputId} type="password" autoComplete="current-password" autoFocus value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            aria-invalid={!!error || undefined} aria-describedby={error ? errId : undefined}
            className={`mt-1 w-full h-12 px-3 rounded-md border bg-bg text-base focus:outline-2 focus:outline-focus focus:outline-offset-0 ${error ? "border-danger" : "border-border-input"}`}
          />
          {error && <p id={errId} role="alert" className="text-xs text-danger mt-1">{error}</p>}
        </div>
        <Button type="submit" size="lg" className="w-full text-sm" loading={busy}>Enter</Button>
      </form>
    </div>
  );
}

export default function EnterPage() {
  return <Suspense><EnterForm /></Suspense>;
}
