import Link from "next/link";
import { notFound } from "next/navigation";

// Placeholder legal pages. architecture.md: a lawyer reads the real terms before launch.
const PAGES: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: "Terms of use (draft)",
    body: [
      "Use Cleanup only on videos you own or have written permission to edit.",
      "Don't use it to remove someone else's watermark, logo, credit or copyright notice, or a label that shows a video was made or edited with AI.",
      "Each upload records that you agreed to this, with the date and the version of these terms.",
      "We remove content and close accounts when we receive a valid copyright complaint.",
      "This draft is a placeholder and isn't legal advice. It will be replaced by terms reviewed by a lawyer before launch.",
    ],
  },
  privacy: {
    title: "Privacy (draft)",
    body: [
      "Your videos are stored privately and only reachable through short-lived links made for you. They're deleted when your plan's retention ends (1 to 30 days), and never used to train models.",
      "Cleaning currently runs in your own browser tab; your videos are uploaded only so you can come back to them and download results.",
      "Processors we use: Supabase (database, sign-in, file storage), Stripe (payments; we never see card numbers), Resend (email), and our hosting provider. A GPU processing provider will be added and listed here before it's used.",
      "We record the date you confirmed you have the rights to each video. We don't sell data or use ad trackers.",
      "Delete your account at any time from the Your videos page: every file, record and subscription goes with it.",
    ],
  },
  takedown: {
    title: "Copyright & takedown",
    body: [
      "If you believe a video processed with Cleanup infringes your rights, send a notice with: your name and contact details, the work you own, where the infringing copy is, a statement of good faith, and your signature.",
      "Send it through the takedown form (POST /api/takedowns; a page form arrives with /replica-launch) or to the address on our contact page. We act on valid notices and remove the content.",
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(PAGES).map((page) => ({ page }));
}

export default async function LegalPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  const p = PAGES[page];
  if (!p) notFound();
  return (
    <article className="mx-auto max-w-[720px] px-4 py-12">
      <h1 className="text-xl">{p.title}</h1>
      <ul className="mt-6 space-y-3 list-disc pl-5 text-base">
        {p.body.map((b) => <li key={b}>{b}</li>)}
      </ul>
      <Link href="/" className="inline-block mt-8 text-accent underline">Back to Cleanup</Link>
    </article>
  );
}
