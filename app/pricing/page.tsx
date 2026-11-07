"use client";
import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useStore } from "@/lib/data/hooks";
import { getState } from "@/lib/data/store";
import { formatDuration } from "@/lib/format";
import { PLANS, RESOLUTIONS, type Plan } from "@/lib/plans";

const PAID: Plan[] = [PLANS.free, PLANS.plus, PLANS.pro];

const res = (p: Plan) => (p.maxResolution ? RESOLUTIONS.find((r) => r.id === p.maxResolution)!.label : null);

const ROWS: { group: string; rows: { label: string; value: (p: Plan) => string | boolean }[] }[] = [
  { group: "Cleaning", rows: [
    { label: "Previews a day (first 5 s)", value: (p) => `${p.previewsPerDay}` },
    { label: "Automatic detection", value: () => true },
    { label: "Erase and keep zones", value: () => true },
    { label: "Batch of 30 videos", value: () => true },
  ] },
  { group: "Export", rows: [
    { label: "Full-length exports a day", value: (p) => (p.exportsPerDay ? `${p.exportsPerDay}` : false) },
    { label: "Highest resolution", value: (p) => res(p) ?? false },
    { label: "Longest video", value: (p) => formatDuration(p.maxDurationMs) },
  ] },
  { group: "Storage", rows: [{ label: "Files kept for", value: (p) => `${p.retentionDays} day${p.retentionDays === 1 ? "" : "s"}` }] },
];

const FAQ = [
  { q: "Can I cancel any time?", a: "Yes. Cancel from your account and you keep the plan until the end of the period you paid for." },
  { q: "What counts as an export?", a: "One full-length render of one video at one resolution. Re-downloading a finished export doesn't count again, and failed exports are given back." },
  { q: "When do daily limits reset?", a: "At midnight UTC. The header shows how many hours are left." },
];

export default function PricingPage() {
  return <Suspense><Pricing /></Suspense>;
}

function Pricing() {
  const { hydrated } = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const [yearly, setYearly] = useState(params.get("interval") !== "month");
  const [pending, setPending] = useState<string | null>(null);
  const resumed = useRef(false);

  const choose = useCallback(async (plan: "plus" | "pro", interval: "month" | "year") => {
    const profile = getState().profile;
    if (!profile || profile.isAnonymous) {
      router.push(`/login?next=${encodeURIComponent(`/pricing?plan=${plan}&interval=${interval}`)}`);
      return;
    }
    setPending(plan);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, interval }) });
      const data = await res.json();
      if (res.ok && data.url) window.location.href = data.url;
      else toast(data.error?.message ?? "Couldn't start checkout.", "error");
    } finally {
      setPending(null);
    }
  }, [router]);

  // Back from signing in with a plan picked: carry on to checkout once.
  useEffect(() => {
    const plan = params.get("plan");
    if (!hydrated || resumed.current || (plan !== "plus" && plan !== "pro")) return;
    const profile = getState().profile;
    if (!profile || profile.isAnonymous) return;
    resumed.current = true;
    void choose(plan, params.get("interval") === "month" ? "month" : "year");
  }, [hydrated, params, choose]);

  useEffect(() => {
    if (params.get("checkout") === "canceled") toast("Checkout canceled. Nothing was charged.", "info");
  }, [params]);
  return (
    <div className="mx-auto max-w-page px-4 lg:px-8 py-12">
      <div className="text-center max-w-[720px] mx-auto">
        <h1 className="text-[clamp(32px,5vw,var(--t-text-2xl))] font-bold">Pay for the exports, not the tries</h1>
        <p className="text-md text-text-muted mt-3">Every plan previews for free. Upgrade when you want the whole video.</p>
        <div className="mt-6 inline-flex items-center gap-1 p-1 rounded-lg bg-surface border border-border" role="radiogroup" aria-label="Billing period">
          {[false, true].map((y) => (
            <button key={String(y)} role="radio" aria-checked={yearly === y} onClick={() => setYearly(y)}
              className={`h-9 px-4 rounded-md text-sm inline-flex items-center gap-2 ${yearly === y ? "bg-surface-raised shadow-card font-semibold" : "text-text-muted hover:text-text"}`}>
              {y ? "Yearly" : "Monthly"}
              {y && <span className="h-5 px-2 rounded-pill bg-success-soft text-success text-xs grid place-items-center">Save 25%</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid md:grid-cols-3 gap-4" aria-live="polite">
        {PAID.map((p) => {
          const price = yearly ? p.yearlyPerMonth : p.monthly;
          const featured = p.id === "plus";
          return (
            <div key={p.id} className={`relative rounded-2xl bg-surface-raised p-6 flex flex-col ${featured ? "border-2 border-accent shadow-raised" : "border border-border shadow-card"}`}>
              {featured && <span className="absolute -top-3 left-6 h-6 px-2 rounded-pill bg-accent-soft text-accent-hover text-xs font-medium grid place-items-center">Most popular</span>}
              <h2 className="text-lg">{p.name}</h2>
              <p className="text-sm text-text-muted">{p.pitch}</p>
              <p className="mt-4" aria-label={`${price} dollars per month`}>
                <span className="text-2xl font-bold tabnums">${price}</span>
                {!!price && <span className="text-sm text-text-muted">/mo</span>}
              </p>
              <p className="text-xs text-text-muted h-8">{!price ? "No card needed" : yearly ? `Billed $${price * 12} a year` : "Renews monthly, cancel any time"}</p>
              {p.id === "free" ? (
                <Link href="/" className={buttonClass("outline", "lg", "w-full")}>Start cleaning</Link>
              ) : (
                <Button variant={featured ? "primary" : "secondary"} size="lg" className="w-full" loading={pending === p.id}
                  onClick={() => choose(p.id as "plus" | "pro", yearly ? "year" : "month")}>
                  Choose {p.name}
                </Button>
              )}
              <ul className="mt-6 space-y-2 text-sm">
                <li className="flex gap-2"><Check className="size-4 text-success mt-0.5 shrink-0" aria-hidden />{p.previewsPerDay} previews a day</li>
                <li className="flex gap-2">{p.exportsPerDay ? <Check className="size-4 text-success mt-0.5 shrink-0" aria-hidden /> : <Minus className="size-4 text-text-muted mt-0.5 shrink-0" aria-hidden />}{p.exportsPerDay ? `${p.exportsPerDay} full exports a day, up to ${res(p)}` : "Preview downloads only"}</li>
                <li className="flex gap-2"><Check className="size-4 text-success mt-0.5 shrink-0" aria-hidden />Videos up to {formatDuration(p.maxDurationMs)}</li>
              </ul>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-text-muted mt-3 text-center">Prices are placeholders. Checkout runs in Stripe test mode until launch.</p>

      <section className="mt-16" aria-labelledby="compare">
        <h2 id="compare" className="text-xl">Compare plans</h2>
        {/* relative: keeps the absolutely positioned sr-only labels inside the scroll box on phones */}
        {/* tabIndex + region: on phones the table scrolls sideways, so keyboard users must be able to focus it */}
        <div className="relative mt-4 overflow-x-auto rounded-xl border border-border focus-visible:outline-2 focus-visible:outline-accent" tabIndex={0} role="region" aria-labelledby="compare">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-surface">
              <tr>
                <th scope="col" className="text-left font-semibold p-3 sticky left-0 bg-surface">Feature</th>
                {PAID.map((p) => <th key={p.id} scope="col" className="text-left font-semibold p-3">{p.name}</th>)}
              </tr>
            </thead>
            {ROWS.map((g) => (
              <tbody key={g.group}>
                <tr><th scope="rowgroup" colSpan={4} className="text-left text-xs font-medium text-text-muted px-3 pt-4 pb-1">{g.group}</th></tr>
                {g.rows.map((r) => (
                  <tr key={r.label} className="border-t border-border">
                    <th scope="row" className="text-left font-normal p-3 sticky left-0 bg-bg">{r.label}</th>
                    {PAID.map((p) => {
                      const v = r.value(p);
                      return (
                        <td key={p.id} className="p-3 tabnums">
                          {v === true ? <><Check className="size-4 text-success" aria-hidden /><span className="sr-only">Included</span></>
                            : v === false ? <><Minus className="size-4 text-text-muted" aria-hidden /><span className="sr-only">Not included</span></> : v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      <section className="mt-16 max-w-[880px]" aria-labelledby="pfaq">
        <h2 id="pfaq" className="text-xl">Billing questions</h2>
        <div className="mt-4 divide-y divide-border border-y border-border">
          {FAQ.map((f) => (
            <details key={f.q} className="group">
              <summary className="cursor-pointer list-none min-h-14 py-3 flex items-center justify-between gap-4 text-base font-semibold">
                {f.q}<span className="text-text-muted transition-transform group-open:rotate-180" aria-hidden>⌄</span>
              </summary>
              <p className="pb-4 text-sm text-text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
