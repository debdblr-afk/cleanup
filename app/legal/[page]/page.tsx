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
      "In this preview, videos never leave your browser: they're stored and processed on your device.",
      "Once the service runs on servers, uploads are kept only as long as your plan says, then deleted, and never used to train models without your opt-in.",
      "You can delete everything at any time from the Your videos page.",
    ],
  },
  takedown: {
    title: "Copyright & takedown",
    body: [
      "If you believe a video processed with Cleanup infringes your rights, send a notice with: your name and contact details, the work you own, where the infringing copy is, a statement of good faith, and your signature.",
      "The online form opens with the server version. Until then, this preview stores nothing outside the user's own browser.",
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
