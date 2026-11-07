"use client";
import { ChevronsLeftRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Split slider. Pass two videos (original + cleaned, kept in sync) or any two layers.
 * The handle is a real slider: arrows move 5%, Home/End jump to the ends.
 */
export function BeforeAfter({
  before, after, beforeVideo, afterVideo, labels = ["Original", "Cleaned"], className = "", rounded = "rounded-xl", autoPlay = true, limitS,
}: {
  before?: ReactNode; after?: ReactNode; beforeVideo?: string | null; afterVideo?: string | null;
  labels?: [string, string]; className?: string; rounded?: string; autoPlay?: boolean; limitS?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const vBefore = useRef<HTMLVideoElement>(null);
  const vAfter = useRef<HTMLVideoElement>(null);
  const [pos, setPos] = useState(50);
  const dragging = useRef(false);

  const fromEvent = useCallback((clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  }, []);

  // The cleaned clip drives the clock; the original follows it.
  useEffect(() => {
    const a = vAfter.current, b = vBefore.current;
    if (!a || !b) return;
    const sync = () => {
      if (limitS && b.currentTime > limitS) b.currentTime = 0;
      if (Math.abs(b.currentTime - a.currentTime) > 0.12) b.currentTime = a.currentTime;
    };
    const play = () => { void b.play().catch(() => {}); };
    const pause = () => b.pause();
    a.addEventListener("timeupdate", sync);
    a.addEventListener("seeked", sync);
    a.addEventListener("play", play);
    a.addEventListener("pause", pause);
    return () => {
      a.removeEventListener("timeupdate", sync);
      a.removeEventListener("seeked", sync);
      a.removeEventListener("play", play);
      a.removeEventListener("pause", pause);
    };
  }, [beforeVideo, afterVideo, limitS]);

  const media = (src: string | null | undefined, ref: React.RefObject<HTMLVideoElement | null>, lead: boolean) =>
    src ? (
      <video
        ref={ref} src={src} muted playsInline loop={lead} autoPlay={autoPlay && lead} preload="auto" aria-hidden
        className="absolute inset-0 size-full object-contain bg-canvas"
      />
    ) : null;

  return (
    <div
      ref={box}
      className={`relative aspect-video overflow-hidden select-none touch-none bg-canvas ${rounded} ${className}`}
      onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); fromEvent(e.clientX); }}
      onPointerMove={(e) => dragging.current && fromEvent(e.clientX)}
      onPointerUp={() => { dragging.current = false; }}
    >
      <div className="absolute inset-0">{after ?? media(afterVideo, vAfter, true)}</div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>{before ?? media(beforeVideo, vBefore, false)}</div>
      <span className="absolute top-3 left-3 h-7 px-3 rounded-pill bg-chip-on-video text-white text-sm grid place-items-center pointer-events-none">{labels[0]}</span>
      <span className="absolute top-3 right-3 h-7 px-3 rounded-pill bg-chip-on-video text-white text-sm grid place-items-center pointer-events-none">{labels[1]}</span>
      <div className="absolute inset-y-0 w-0.5 bg-white pointer-events-none" style={{ left: `calc(${pos}% - 1px)` }} />
      <div
        role="slider" tabIndex={0} aria-label="Compare original and cleaned" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)} aria-valuetext={`${Math.round(pos)}% original`}
        onKeyDown={(e) => {
          const map: Record<string, number> = { ArrowLeft: pos - 5, ArrowRight: pos + 5, Home: 0, End: 100 };
          if (e.key in map) { e.preventDefault(); setPos(Math.max(0, Math.min(100, map[e.key]))); }
        }}
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 size-10 rounded-pill bg-white text-text shadow-raised grid place-items-center cursor-ew-resize focus-visible:outline-on-canvas"
        style={{ left: `${pos}%` }}
      >
        <ChevronsLeftRight className="size-5" aria-hidden />
      </div>
    </div>
  );
}

/** Our own stand-in frame for marketing sections: a gradient "scene" and an optional fake mark. */
export function DemoFrame({ mark }: { mark?: string }) {
  return (
    <div className="absolute inset-0 scene">
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/35 to-transparent" />
      {mark && <span className="absolute right-[7%] bottom-[9%] text-white/85 font-bold text-[clamp(14px,3vw,28px)] tracking-wide">{mark}</span>}
    </div>
  );
}
