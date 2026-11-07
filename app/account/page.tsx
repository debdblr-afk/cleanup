"use client";
import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, buttonClass, EmptyState, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useStore } from "@/lib/data/hooks";
import { deleteEverything, getPlan, getState, liveVideos, quotaStatus, setDemoPlan } from "@/lib/data/store";
import { PLANS } from "@/lib/plans";
import type { PlanId } from "@/lib/types";

export default function AccountPage() {
  const { hydrated } = useStore();
  const [confirm, setConfirm] = useState(false);
  if (!hydrated) return <div className="mx-auto max-w-page px-4 lg:px-8 py-8"><Skeleton className="h-8 w-40" /><Skeleton className="h-40 mt-6" /></div>;

  const plan = getPlan();
  const q = quotaStatus();
  const batches = [...getState().batches.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="mx-auto max-w-page px-4 lg:px-8 py-8 grid lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
      <section aria-labelledby="yours">
        <h1 id="yours" className="text-xl">Your videos</h1>
        {batches.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={<Clapperboard />} title="Nothing here yet" body="Batches you start in this browser show up here until they expire."
              action={<Link href="/" className={buttonClass("primary", "md")}>Upload videos</Link>} />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border border-y border-border">
            {batches.map((b) => {
              const vids = liveVideos(b.id);
              return (
                <li key={b.id}>
                  <Link href={`/b/${b.id}`} className="flex items-center gap-4 py-3 hover:bg-surface -mx-2 px-2 rounded-md">
                    <div className="flex -space-x-3">
                      {vids.slice(0, 3).map((v) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={v.id} src={v.thumbnail ?? undefined} alt="" className="w-16 aspect-video object-cover rounded-sm border-2 border-bg bg-canvas" />
                      ))}
                    </div>
                    <span className="min-w-0">
                      <span className="block font-medium">{new Date(b.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                      <span className="block text-sm text-text-muted">{vids.length} video{vids.length === 1 ? "" : "s"} · kept until {new Date(b.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <aside className="space-y-6">
        <section className="rounded-xl border border-border p-5" aria-labelledby="plan-h">
          <h2 id="plan-h" className="text-lg">Plan: {plan.name}</h2>
          <p className="text-sm text-text-muted mt-1 tabnums">{q.previewsLeft} of {q.previewsCap} previews and {q.exportsLeft} of {q.exportsCap} exports left today.</p>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Demo mode: try a plan without paying</legend>
            <p className="text-xs text-text-muted mt-1">Payments aren&apos;t connected yet. This changes the limits in this browser only.</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(Object.keys(PLANS) as PlanId[]).map((id) => (
                <label key={id} className={`h-10 px-3 rounded-md flex items-center gap-2 text-sm cursor-pointer ${plan.id === id ? "border-2 border-accent bg-accent-soft font-semibold" : "border border-border-input"}`}>
                  <input type="radio" name="plan" checked={plan.id === id} onChange={() => { setDemoPlan(id); toast(`Now on ${PLANS[id].name} (demo)`); }} className="accent-[var(--t-color-accent)]" />
                  {PLANS[id].name}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="rounded-xl border border-border p-5" aria-labelledby="data-h">
          <h2 id="data-h" className="text-lg">Your data</h2>
          <p className="text-sm text-text-muted mt-1">Videos, previews and exports are stored in this browser only.</p>
          <Button variant="danger" className="mt-4" onClick={() => setConfirm(true)}>Delete everything</Button>
        </section>
      </aside>

      <Dialog open={confirm} onOpenChange={setConfirm} size="sm" title="Delete everything?" description="Every batch, video, preview and export in this browser is removed. This can't be undone.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" onClick={async () => { await deleteEverything(); setConfirm(false); toast("Deleted everything"); }}>Delete</Button>
        </div>
      </Dialog>
    </div>
  );
}
