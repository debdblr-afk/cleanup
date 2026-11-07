"use client";
import { useState } from "react";
import { BeforeAfter, DemoFrame } from "@/components/batch/before-after";
import { UploadPanel } from "@/components/upload/upload-panel";

const STEPS = [
  { title: "Add your videos", body: "Drop in up to 30 files at once. Each one gets its own card so you can check them side by side." },
  { title: "We find the mark", body: "Cleanup spots logos and text that sit still while the picture moves, and paints them out." },
  { title: "Check, then download", body: "Compare the first 5 seconds for free. Happy with it? Export the whole video." },
];

const FEATURES = [
  { id: "auto", tab: "Finds it for you", title: "Automatic detection", body: "Marks that stay in one place while the scene changes are picked up on their own. No drawing needed for the usual corner logo or handle." },
  { id: "hand", tab: "Fix by hand", title: "Erase and keep zones", body: "Missed a spot? Draw an erase box over it. Want a face or a product left exactly as it is? Draw a keep zone and nothing inside it changes." },
  { id: "batch", tab: "Many at once", title: "Batches of 30", body: "Clean a week of posts in one go. Every video is processed and previewed on its own card, and one failure never holds up the rest." },
  { id: "free", tab: "Try before you pay", title: "Free 5-second preview", body: "See the result on your own footage before spending anything. The full-length export is the only part that's paid." },
];

const FAQ = [
  { q: "Whose videos can I clean?", a: "Your own, or ones you have permission to edit. Cleanup is for removing your old branding, burned-in captions and stray text, not for taking someone else's watermark off their work. Rights holders can report misuse on the takedown page." },
  { q: "Does it work on moving watermarks?", a: "Static marks work today. Tracking marks that drift across the frame comes with the GPU engine. Until then, draw an erase zone over the area they move through." },
  { q: "Where do my files go?", a: "In this preview version, nowhere: videos are stored and processed in your own browser and never uploaded. You can delete everything from the Your videos page." },
  { q: "What do I get for free?", a: "Three previews a day as a guest, each showing the first 5 seconds cleaned. Full-length exports are on the paid plans." },
];

export default function Home() {
  const [tab, setTab] = useState(FEATURES[0].id);
  const active = FEATURES.find((f) => f.id === tab)!;
  return (
    <>
      <section className="mx-auto max-w-page px-4 lg:px-8 pt-10 lg:pt-16">
        <div className="text-center max-w-[880px] mx-auto">
          <h1 className="text-[clamp(36px,6vw,var(--t-text-display))] leading-[1.12] font-bold tracking-[-0.02em]">Take the logo off your video</h1>
          <p className="text-md text-text-muted mt-4">
            Remove your own watermarks, burned-in captions and stray text. Cleanup finds the mark, paints it out, and shows you the result before you pay a thing.
          </p>
        </div>
        <div className="mt-10 grid lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 order-2 lg:order-1">
            <BeforeAfter before={<DemoFrame mark="yourbrand.tv" />} after={<DemoFrame />} />
            <p className="text-xs text-text-muted mt-2">Drag the handle or use the arrow keys to compare.</p>
          </div>
          <div className="lg:col-span-5 order-1 lg:order-2">
            <UploadPanel variant="hero" />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-page px-4 lg:px-8 py-16 lg:py-24" aria-labelledby="how">
        <h2 id="how" className="text-[clamp(28px,4vw,var(--t-text-2xl))] font-bold text-center">How it works</h2>
        <ol className="mt-10 grid md:grid-cols-3 gap-8">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="size-8 rounded-pill bg-accent-soft text-accent-hover grid place-items-center text-sm font-semibold" aria-hidden>{i + 1}</span>
              <h3 className="text-lg mt-3">{s.title}</h3>
              <p className="text-base text-text-muted mt-1">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-surface py-16 lg:py-24" aria-labelledby="features">
        <div className="mx-auto max-w-page px-4 lg:px-8">
          <h2 id="features" className="text-[clamp(28px,4vw,var(--t-text-2xl))] font-bold text-center">Made for the clean-up jobs you actually have</h2>
          <div role="tablist" aria-label="Features" className="mt-8 flex flex-wrap justify-center gap-2"
            onKeyDown={(e) => {
              const i = FEATURES.findIndex((f) => f.id === tab);
              const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
              if (next == null) return;
              const f = FEATURES[(next + FEATURES.length) % FEATURES.length];
              setTab(f.id);
              document.getElementById(`tab-${f.id}`)?.focus();
            }}>
            {FEATURES.map((f) => (
              <button
                key={f.id} id={`tab-${f.id}`} role="tab" aria-selected={tab === f.id} aria-controls="feature-panel" tabIndex={tab === f.id ? 0 : -1}
                onClick={() => setTab(f.id)}
                className={`h-10 px-3.5 rounded-md border-2 text-sm transition-colors ${tab === f.id ? "bg-accent text-on-accent border-accent font-semibold" : "bg-surface-raised border-border hover:bg-surface-hover"}`}
              >
                {f.tab}
              </button>
            ))}
          </div>
          <div id="feature-panel" role="tabpanel" aria-labelledby={`tab-${active.id}`} className="mt-8 grid lg:grid-cols-2 gap-8 items-center">
            <BeforeAfter before={<DemoFrame mark={active.id === "hand" ? "@oldhandle" : "yourbrand.tv"} />} after={<DemoFrame />} />
            <div>
              <h3 className="text-xl">{active.title}</h3>
              <p className="text-base text-text-muted mt-2">{active.body}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[880px] px-4 lg:px-8 py-16 lg:py-24" aria-labelledby="faq">
        <h2 id="faq" className="text-[clamp(28px,4vw,var(--t-text-2xl))] font-bold text-center">Questions</h2>
        <div className="mt-8 divide-y divide-border border-y border-border">
          {FAQ.map((f) => (
            <details key={f.q} className="group">
              <summary className="cursor-pointer list-none min-h-14 py-3 flex items-center justify-between gap-4 text-base font-semibold">
                {f.q}
                <span className="text-text-muted transition-transform group-open:rotate-180" aria-hidden>⌄</span>
              </summary>
              <p className="pb-4 text-sm text-text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
