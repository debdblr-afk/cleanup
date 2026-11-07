"use client";
import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

type Toast = { id: number; tone: "success" | "error" | "info"; text: string; action?: { label: string; onClick: () => void } };

let toasts: Toast[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function toast(text: string, tone: Toast["tone"] = "success", action?: Toast["action"]) {
  toasts = [...toasts.slice(-2), { id: ++seq, tone, text, action }];
  emit();
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const EMPTY: Toast[] = [];

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => toasts,
    () => EMPTY,
  );
  return (
    <div className="fixed z-50 bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 sm:w-[380px] flex flex-col gap-2" aria-live="polite">
      {list.map((t) => <ToastItem key={t.id} t={t} />)}
    </div>
  );
}

function ToastItem({ t }: { t: Toast }) {
  useEffect(() => {
    if (t.tone === "error") return; // errors stay until dismissed
    const h = setTimeout(() => dismiss(t.id), 5000);
    return () => clearTimeout(h);
  }, [t]);
  const stripe = { success: "bg-mask-protect", error: "bg-mask-erase", info: "bg-canvas-muted" }[t.tone];
  const Icon = { success: CircleCheck, error: CircleX, info: Info }[t.tone];
  return (
    <div role={t.tone === "error" ? "alert" : "status"} className="flex items-center gap-3 bg-ink text-on-ink rounded-lg shadow-pop pr-1 min-h-12 overflow-hidden animate-[rise_var(--t-motion-base)_var(--t-motion-ease)]">
      <span className={`w-1 self-stretch ${stripe}`} aria-hidden />
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="text-sm flex-1 py-3">{t.text}</span>
      {t.action && (
        <button className="text-sm font-semibold underline px-2" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button>
      )}
      <button className="size-10 grid place-items-center rounded-md hover:bg-ink-hover" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
