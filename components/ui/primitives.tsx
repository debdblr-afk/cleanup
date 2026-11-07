"use client";
// Primitives from replica-watermark/design/components.md. Role classes only, no raw values.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CircleCheck, CircleX, Clock, LoaderCircle, ScanSearch, TriangleAlert } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-ink text-on-ink hover:bg-ink-hover",
  outline: "border border-border-input bg-bg text-text hover:bg-surface-hover",
  ghost: "text-text hover:bg-surface-hover",
  danger: "bg-danger text-on-accent hover:opacity-90",
};
const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm font-semibold rounded-md gap-1.5 pointer-coarse:h-11",
  md: "h-10 px-4 text-sm font-semibold rounded-md gap-2",
  lg: "h-14 px-6 text-md font-semibold rounded-lg gap-2",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = "") {
  return `inline-flex items-center justify-center whitespace-nowrap transition-colors duration-[var(--t-motion-fast)] active:translate-y-px disabled:opacity-45 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${extra}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className = "", children, disabled, type = "button", ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: "light" | "canvas"; pressed?: boolean }>(
  function IconButton({ label, tone = "light", pressed, className = "", children, type = "button", ...rest }, ref) {
    const base = tone === "canvas" ? "text-on-canvas hover:bg-canvas-raised" : "text-text hover:bg-surface-hover";
    const on = pressed ? (tone === "canvas" ? "bg-accent text-on-accent hover:bg-accent-hover" : "bg-accent-soft text-accent-hover") : "";
    return (
      <button ref={ref} type={type} aria-label={label} title={label} aria-pressed={pressed} className={`size-10 pointer-coarse:size-11 grid place-items-center rounded-md transition-colors disabled:opacity-45 disabled:pointer-events-none ${base} ${on} ${className}`} {...rest}>
        {children}
      </button>
    );
  },
);

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";
const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-hover text-text-muted",
  info: "bg-accent-soft text-accent-hover",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};
const toneIcon: Record<BadgeTone, ReactNode> = {
  neutral: <Clock className="size-3" aria-hidden />,
  info: <ScanSearch className="size-3" aria-hidden />,
  success: <CircleCheck className="size-3" aria-hidden />,
  warning: <TriangleAlert className="size-3" aria-hidden />,
  danger: <CircleX className="size-3" aria-hidden />,
};

export function StatusBadge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-pill text-xs ${tones[tone]}`}>{toneIcon[tone]}{children}</span>;
}

export function ProgressBar({ value, label, size = "sm" }: { value: number | null; label: string; size?: "sm" | "lg" }) {
  const h = size === "lg" ? "h-2" : "h-1";
  return (
    <div className={`${h} rounded-pill bg-surface-hover overflow-hidden`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
      {value == null
        ? <div className="h-full w-[30%] bg-accent rounded-pill animate-[slide_1.4s_var(--t-motion-ease)_infinite] motion-reduce:animate-none motion-reduce:translate-x-1/2" />
        : <div className="h-full bg-accent rounded-pill transition-[width] duration-[var(--t-motion-base)]" style={{ width: `${Math.max(2, value)}%` }} />}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 shrink-0 rounded-pill transition-colors disabled:opacity-45 ${checked ? "bg-accent" : "bg-border-input"}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-pill bg-white shadow-card transition-[left] duration-[var(--t-motion-fast)] ${checked ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

export function Checkbox({ checked, onChange, id, invalid, describedBy }: { checked: boolean; onChange: (v: boolean) => void; id: string; invalid?: boolean; describedBy?: string }) {
  return (
    <input
      id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
      aria-invalid={invalid || undefined} aria-describedby={describedBy}
      className={`mt-0.5 size-5 shrink-0 rounded-sm accent-[var(--t-color-accent)] ${invalid ? "outline-2 outline-danger outline-offset-2" : ""}`}
    />
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-10 text-center">
      <div className="mx-auto w-fit text-text-muted [&_svg]:size-10" aria-hidden>{icon}</div>
      <h2 className="text-lg mt-3">{title}</h2>
      <p className="text-sm text-text-muted mt-1">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-surface-hover rounded-md animate-pulse motion-reduce:animate-none ${className}`} aria-hidden />;
}
