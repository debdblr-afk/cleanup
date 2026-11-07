"use client";
import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buttonClass } from "@/components/ui/primitives";
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
  const [yearly, setYearly] = useState(true);
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
              <Link href={p.id === "free" ? "/" : `/login?next=checkout&plan=${p.id}&interval=${yearly ? "year" : "month"}`}
                className={buttonClass(featured ? "primary" : p.id === "pro" ? "secondary" : "outline", "lg", "w-full")}>
                {p.id === "free" ? "Start cleaning" : `Choose ${p.name}`}
              </Link>
              <ul className="mt-6 space-y-2 text-sm">
                <li className="flex gap-2"><Check className="size-4 text-success mt-0.5 shrink-0" aria-hidden />{p.previewsPerDay} previews a day</li>
                <li className="flex gap-2">{p.exportsPerDay ? <Check className="size-4 text-success mt-0.5 shrink-0" aria-hidden /> : <Minus className="size-4 text-text-muted mt-0.5 shrink-0" aria-hidden />}{p.exportsPerDay ? `${p.exportsPerDay} full exports a day, up to ${res(p)}` : "Preview downloads only"}</li>
                <li className="flex gap-2"><Check className="size-4 text-success mt-0.5 shrink-0" aria-hidden />Videos up to {formatDuration(p.maxDurationMs)}</li>
              </ul>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-text-muted mt-3 text-center">Prices are placeholders. Payments aren&apos;t connected yet.</p>

      <section className="mt-16" aria-labelledby="compare">
        <h2 id="compare" className="text-xl">Compare plans</h2>
        {/* relative: keeps the absolutely positioned sr-only labels inside the scroll box on phones */}
        <div className="relative mt-4 overflow-x-auto rounded-xl border border-border">
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
