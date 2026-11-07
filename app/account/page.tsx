"use client";
import { Clapperboard } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, buttonClass, EmptyState, Skeleton } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useStore } from "@/lib/data/hooks";
import { deleteEverything, getPlan, getState, liveVideos, quotaStatus, signOut } from "@/lib/data/store";
import { formatBytes, formatDuration } from "@/lib/format";

function Account() {
  const { hydrated } = useStore();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!hydrated) return <div className="mx-auto max-w-page px-4 lg:px-8 py-8"><Skeleton className="h-8 w-40" /><Skeleton className="h-40 mt-6" /></div>;

  const { profile } = getState();
  const plan = getPlan();
  const q = quotaStatus();
  const batches = [...getState().batches.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="mx-auto max-w-page px-4 lg:px-8 py-8 grid lg:grid-cols-[minmax(0,1fr)_360px] gap-8 items-start">
      <section aria-labelledby="yours">
        <h1 id="yours" className="text-xl">Your videos</h1>
        {batches.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={<Clapperboard />} title="Nothing here yet" body="Batches you start show up here until they expire."
              action={<Link href="/" className={buttonClass("primary", "md")}>Upload videos</Link>} />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border border-y border-border">
            {batches.map((b) => {
              const vids = liveVideos(b.id);
              return (
                <li key={b.id}>
                  <Link href={`/b/${b.id}`} className="flex items-center gap-4 py-3 hover:bg-surface -mx-2 px-2 rounded-md">
                    <div className="flex -space-x-3 shrink-0 w-28">
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
        <section className="rounded-xl border border-border p-5 space-y-3" aria-labelledby="acct-h">
          <h2 id="acct-h" className="text-lg">Account</h2>
          {!profile ? (
            <p className="text-sm text-text-muted">You&apos;re not signed in. Upload a video to start as a guest, or <Link href="/login" className="text-accent underline">sign in</Link>.</p>
          ) : profile.isAnonymous ? (
            <>
              <p className="text-sm text-text-muted">You&apos;re using a guest session. Add your email to keep your batches and come back to them from any device.</p>
              <Link href="/login" className={buttonClass("primary", "md")}>Save my work</Link>
            </>
          ) : (
            <>
              <p className="text-sm">Signed in as <strong className="break-all">{profile.email}</strong></p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={async () => { await signOut(false); router.push("/"); }}>Sign out</Button>
                <Button variant="ghost" size="sm" onClick={async () => { await signOut(true); toast("Signed out on every device"); router.push("/"); }}>Sign out everywhere</Button>
              </div>
            </>
          )}
        </section>

        <section className="rounded-xl border border-border p-5" aria-labelledby="plan-h">
          <h2 id="plan-h" className="text-lg">Today</h2>
          <p className="text-sm text-text-muted mt-1 tabnums">{q.previewsLeft} of {q.previewsCap} previews left; they reset at midnight UTC. {q.exportsUnlimited ? "Exports are unlimited." : `${q.exportsLeft} of ${q.exportsCap} exports left.`}</p>
          <p className="text-sm text-text-muted mt-2">Videos up to {formatDuration(plan.maxDurationMs)} and {formatBytes(plan.maxBytes)}, exported in up to 4K (never above your video&apos;s own resolution), kept for {plan.retentionDays} days.</p>
        </section>

        {profile && (
          <section className="rounded-xl border border-border p-5" aria-labelledby="data-h">
            <h2 id="data-h" className="text-lg">Delete account</h2>
            <p className="text-sm text-text-muted mt-1">Removes every video, preview and export, cancels any subscription, and deletes the account.</p>
            <Button variant="danger" className="mt-4" onClick={() => setConfirm(true)}>Delete my account</Button>
          </section>
        )}
      </aside>

      <Dialog open={confirm} onOpenChange={setConfirm} size="sm" title="Delete your account?" description="Every batch, video, preview and export is removed and any subscription is canceled. This can't be undone.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" loading={deleting} onClick={async () => {
            setDeleting(true);
            try { await deleteEverything(); setConfirm(false); toast("Your account was deleted"); router.push("/"); }
            catch (e) { toast(e instanceof Error ? e.message : "Couldn't delete the account.", "error"); }
            finally { setDeleting(false); }
          }}>Delete</Button>
        </div>
      </Dialog>
    </div>
  );
}

export default function AccountPage() {
  return <Suspense><Account /></Suspense>;
}
