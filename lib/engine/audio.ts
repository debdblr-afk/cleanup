// One shared AudioContext for carrying a video's sound into recordings.
//
// Safari only lets audio start inside a click or key press; outside one, resume() stays pending
// forever (BUG-013: a clean that started on its own waited on it and never finished). So the
// context is created and resumed on the visitor's first interaction and then reused, and code
// that needs it never waits more than a moment: no running context means no sound, not a hang.

let ctx: AudioContext | null = null;

function Ctor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null;
}

function context(): AudioContext | null {
  if (ctx) return ctx;
  const C = Ctor();
  if (!C) return null;
  try { ctx = new C(); } catch { ctx = null; }
  return ctx;
}

/** Start audio inside the visitor's first click, tap or key press (and again later if Safari suspends it). */
export function unlockAudioOnInteraction() {
  if (typeof window === "undefined") return;
  const unlock = () => {
    const c = context();
    if (c && c.state !== "running") void c.resume().catch(() => {});
  };
  for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, unlock, { capture: true, passive: true });
}

/** The shared context if it is (or within `waitMs` becomes) running, else null. Never hangs. */
export async function runningAudioContext(waitMs = 800): Promise<AudioContext | null> {
  const c = context();
  if (!c) return null;
  if (c.state === "running") return c;
  await Promise.race([c.resume().catch(() => {}), new Promise((r) => setTimeout(r, waitMs))]);
  return (c.state as AudioContextState) === "running" ? c : null; // may have changed while waiting
}
